import { beforeEach, afterEach, describe, it, expect } from "vitest";
import { createTestDb } from "@/tests/helpers/test-db";
import type { Database } from "@/lib/db";
import {
  createMonitor,
  listMonitors,
  getMonitor,
  deleteMonitor,
  AuthorizationError,
} from "@/lib/queries/monitors";
import { user } from "@/lib/db/schema";

let testDb: Awaited<ReturnType<typeof createTestDb>>;

beforeEach(async () => {
  testDb = await createTestDb();
});

afterEach(async () => {
  await testDb.close();
});

async function seedUser(db: Database, id: string, email: string) {
  await db.insert(user).values({
    id,
    name: "Test User",
    email,
  });
}

describe("createMonitor", () => {
  it("persists row scoped to user — other user sees empty list", async () => {
    const db = testDb.db;
    await seedUser(db, "user-a", "a@example.com");
    await seedUser(db, "user-b", "b@example.com");

    await createMonitor(db, {
      userId: "user-a",
      name: "GA4 Checkout",
      url: "https://example.com/checkout",
    });

    const ownRows = await listMonitors(db, "user-a");
    expect(ownRows).toHaveLength(1);
    expect(ownRows[0].name).toBe("GA4 Checkout");
    expect(ownRows[0].userId).toBe("user-a");

    // Different user sees nothing
    const otherRows = await listMonitors(db, "user-b");
    expect(otherRows).toHaveLength(0);
  });
});

describe("getMonitor", () => {
  it("returns the monitor when userId matches", async () => {
    const db = testDb.db;
    await seedUser(db, "user-a", "a@example.com");

    const created = await createMonitor(db, {
      userId: "user-a",
      name: "Meta Pixel",
      url: "https://example.com/signup",
    });

    const found = await getMonitor(db, created.id, "user-a");
    expect(found).not.toBeNull();
    expect(found?.id).toBe(created.id);
  });

  it("returns null when userId does not match", async () => {
    const db = testDb.db;
    await seedUser(db, "user-a", "a@example.com");
    await seedUser(db, "user-b", "b@example.com");

    const created = await createMonitor(db, {
      userId: "user-a",
      name: "Meta Pixel",
      url: "https://example.com/signup",
    });

    const found = await getMonitor(db, created.id, "user-b");
    expect(found).toBeNull();
  });
});

describe("deleteMonitor", () => {
  it("enforces ownership — wrong userId throws AuthorizationError", async () => {
    const db = testDb.db;
    await seedUser(db, "user-a", "a@example.com");
    await seedUser(db, "user-b", "b@example.com");

    const created = await createMonitor(db, {
      userId: "user-a",
      name: "Google Ads Conversion",
      url: "https://example.com/purchase",
    });

    await expect(deleteMonitor(db, created.id, "user-b")).rejects.toBeInstanceOf(
      AuthorizationError,
    );

    // Row still exists
    const remaining = await listMonitors(db, "user-a");
    expect(remaining).toHaveLength(1);
  });

  it("deletes the row when userId matches", async () => {
    const db = testDb.db;
    await seedUser(db, "user-a", "a@example.com");

    const created = await createMonitor(db, {
      userId: "user-a",
      name: "Stripe Purchase",
      url: "https://example.com/pay",
    });

    await deleteMonitor(db, created.id, "user-a");

    const remaining = await listMonitors(db, "user-a");
    expect(remaining).toHaveLength(0);
  });
});
