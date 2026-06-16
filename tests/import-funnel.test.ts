/**
 * Integration tests for POST /api/monitors/[id]/import-funnel
 *
 * Uses an in-process PGlite database (createTestDb) so the real insertion
 * logic runs against a real schema. Auth and rate-limit are mocked so the
 * test focuses on persistence correctness.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import type { Database } from "@/lib/db";

// ---------------------------------------------------------------------------
// Module-level db ref that our @/lib/db mock proxies to.
// This must be declared before vi.mock calls (hoisting).
// ---------------------------------------------------------------------------
let _db: Database | null = null;

vi.mock("@/lib/db", () => ({
  get db() {
    return _db;
  },
}));

// Mock auth — each test configures the return value via mockGetSession
vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: vi.fn(),
    },
  },
}));

// Mock rate-limit so the route is never blocked during insertion tests
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(() => ({ limited: false, remaining: 9, resetAt: Date.now() + 60_000 })),
}));

// Imports that depend on mocked modules must come after vi.mock declarations
import { createTestDb } from "@/tests/helpers/test-db";
import { POST } from "@/app/api/monitors/[id]/import-funnel/route";
import { user, monitor, funnelStep } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";

const mockGetSession = vi.mocked(auth.api.getSession);

let testDb: Awaited<ReturnType<typeof createTestDb>>;

beforeEach(async () => {
  testDb = await createTestDb();
  _db = testDb.db;

  // Default: authenticated as user-test
  mockGetSession.mockResolvedValue({
    user: {
      id: "user-test",
      name: "Test User",
      email: "test@pixelpulse.dev",
      emailVerified: false,
      image: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    session: {
      id: "session-1",
      userId: "user-test",
      token: "token-abc",
      expiresAt: new Date(Date.now() + 3_600_000),
      ipAddress: null,
      userAgent: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  } as never);
});

afterEach(async () => {
  await testDb.close();
  _db = null;
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function seedUserAndMonitor(): Promise<{ userId: string; monitorId: string }> {
  const db = testDb.db;
  const userId = "user-test";
  const monitorId = "monitor-001";

  await db.insert(user).values({
    id: userId,
    name: "Test User",
    email: "test@pixelpulse.dev",
  });

  await db.insert(monitor).values({
    id: monitorId,
    userId,
    name: "Checkout Funnel",
    url: "https://example.com/checkout",
  });

  return { userId, monitorId };
}

function makeRequest(monitorId: string, body: unknown): NextRequest {
  return new NextRequest(
    `http://localhost:3000/api/monitors/${monitorId}/import-funnel`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/monitors/[id]/import-funnel", () => {
  it("import-funnel inserts steps in order — stepOrder matches array position", async () => {
    const { monitorId } = await seedUserAndMonitor();

    const steps = [
      { actionType: "navigate", payload: { url: "https://example.com/checkout" } },
      { actionType: "fill", payload: { selector: "#email", value: "user@test.com" } },
      { actionType: "click", payload: { selector: "#submit" } },
    ];

    const req = makeRequest(monitorId, steps);
    const res = await POST(req, { params: Promise.resolve({ id: monitorId }) });

    expect(res.status).toBe(201);

    const body = (await res.json()) as { imported: number };
    expect(body.imported).toBe(3);

    // Verify the rows landed in the test DB with correct stepOrder
    const rows = await testDb.db
      .select()
      .from(funnelStep)
      .where(eq(funnelStep.monitorId, monitorId))
      .orderBy(funnelStep.stepOrder);

    expect(rows).toHaveLength(3);
    expect(rows[0].stepOrder).toBe(0);
    expect(rows[0].actionType).toBe("navigate");
    expect(rows[1].stepOrder).toBe(1);
    expect(rows[1].actionType).toBe("fill");
    expect(rows[2].stepOrder).toBe(2);
    expect(rows[2].actionType).toBe("click");
  });

  it("replaces existing funnel steps on re-import", async () => {
    const { monitorId } = await seedUserAndMonitor();

    // First import
    const first = [{ actionType: "navigate", payload: { url: "https://example.com" } }];
    await POST(makeRequest(monitorId, first), {
      params: Promise.resolve({ id: monitorId }),
    });

    // Second import with different steps
    const second = [
      { actionType: "click", payload: { selector: "#cta" } },
      { actionType: "wait", payload: { ms: 500 } },
    ];
    const res = await POST(makeRequest(monitorId, second), {
      params: Promise.resolve({ id: monitorId }),
    });

    expect(res.status).toBe(201);

    const rows = await testDb.db
      .select()
      .from(funnelStep)
      .where(eq(funnelStep.monitorId, monitorId))
      .orderBy(funnelStep.stepOrder);

    // Old step is gone; two new ones
    expect(rows).toHaveLength(2);
    expect(rows[0].actionType).toBe("click");
    expect(rows[1].actionType).toBe("wait");
  });

  it("returns 400 when body is not an array", async () => {
    const { monitorId } = await seedUserAndMonitor();
    const req = makeRequest(monitorId, { actionType: "navigate" });
    const res = await POST(req, { params: Promise.resolve({ id: monitorId }) });
    expect(res.status).toBe(400);
  });

  it("returns 400 when a step has an invalid actionType", async () => {
    const { monitorId } = await seedUserAndMonitor();
    const steps = [{ actionType: "hover", payload: { selector: "#btn" } }];
    const req = makeRequest(monitorId, steps);
    const res = await POST(req, { params: Promise.resolve({ id: monitorId }) });
    expect(res.status).toBe(400);
  });

  it("returns 401 when not authenticated", async () => {
    const { monitorId } = await seedUserAndMonitor();
    mockGetSession.mockResolvedValue(null);
    const steps = [{ actionType: "navigate", payload: { url: "https://example.com" } }];
    const req = makeRequest(monitorId, steps);
    const res = await POST(req, { params: Promise.resolve({ id: monitorId }) });
    expect(res.status).toBe(401);
  });

  it("returns 404 when monitor does not exist", async () => {
    // Seed user but not a monitor
    await testDb.db.insert(user).values({
      id: "user-test",
      name: "Test User",
      email: "test@pixelpulse.dev",
    });

    const steps = [{ actionType: "navigate", payload: { url: "https://example.com" } }];
    const req = makeRequest("nonexistent-monitor", steps);
    const res = await POST(req, {
      params: Promise.resolve({ id: "nonexistent-monitor" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 403 when monitor belongs to a different user", async () => {
    // Seed the real owner's monitor
    await testDb.db.insert(user).values({ id: "user-other", name: "Other", email: "other@x.com" });
    await testDb.db.insert(user).values({ id: "user-test", name: "Test", email: "test@pixelpulse.dev" });
    await testDb.db.insert(monitor).values({
      id: "monitor-other",
      userId: "user-other",
      name: "Other's Funnel",
      url: "https://example.com",
    });

    // Authenticated as user-test; trying to import into other's monitor
    const steps = [{ actionType: "click", payload: { selector: "#btn" } }];
    const req = makeRequest("monitor-other", steps);
    const res = await POST(req, { params: Promise.resolve({ id: "monitor-other" }) });
    expect(res.status).toBe(403);
  });
});
