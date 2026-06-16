/**
 * Integration tests for getUptimeStats and getRecentRuns.
 *
 * These tests run against an in-process Postgres (pglite) with the full schema
 * applied — no Docker, no DATABASE_URL.
 */

import { beforeEach, afterEach, describe, it, expect } from "vitest";

import { createTestDb } from "@/tests/helpers/test-db";
import type { Database } from "@/lib/db";
import { createMonitor } from "@/lib/queries/monitors";
import { addFunnelStep, addEventAssertion } from "@/lib/queries/funnel";
import { checkRun, eventAssertionResult, user } from "@/lib/db/schema";
import { getUptimeStats, getRecentRuns } from "@/lib/queries/uptime";

let testDb: Awaited<ReturnType<typeof createTestDb>>;

beforeEach(async () => {
  testDb = await createTestDb();
});

afterEach(async () => {
  await testDb.close();
});

async function seedUser(db: Database, id: string, email: string) {
  await db.insert(user).values({ id, name: "Test User", email });
}

/**
 * Insert a check_run + eventAssertionResult pair with explicit timestamps so
 * time-window tests can control which rows fall inside/outside the window.
 */
async function seedResult(
  db: Database,
  opts: {
    monitorId: string;
    assertionId: string;
    passed: boolean;
    createdAt: Date;
    diagnosisCode?: "ok" | "event_not_fired";
  },
): Promise<void> {
  const runId = crypto.randomUUID();
  await db.insert(checkRun).values({
    id: runId,
    monitorId: opts.monitorId,
    status: opts.passed ? "passing" : "failed",
    startedAt: opts.createdAt,
    createdAt: opts.createdAt,
  });
  await db.insert(eventAssertionResult).values({
    id: crypto.randomUUID(),
    checkRunId: runId,
    eventAssertionId: opts.assertionId,
    passed: opts.passed,
    diagnosisCode: opts.diagnosisCode ?? (opts.passed ? "ok" : "event_not_fired"),
    createdAt: opts.createdAt,
  });
}

// ---------------------------------------------------------------------------
// getUptimeStats
// ---------------------------------------------------------------------------

describe("getUptimeStats", () => {
  it("returns 100% when all passed", async () => {
    const db = testDb.db;
    await seedUser(db, "user-a", "a@example.com");

    const mon = await createMonitor(db, {
      userId: "user-a",
      name: "GA4 Checkout",
      url: "https://example.com/checkout",
    });

    const step = await addFunnelStep(db, {
      monitorId: mon.id,
      actionType: "navigate",
      payload: { url: "https://example.com/checkout" },
    });

    const assertion = await addEventAssertion(db, "user-a", {
      funnelStepId: step.id,
      platform: "ga4",
      eventName: "Purchase",
    });

    const now = new Date();
    for (let i = 0; i < 10; i++) {
      await seedResult(db, {
        monitorId: mon.id,
        assertionId: assertion.id,
        passed: true,
        createdAt: now,
      });
    }

    const stats = await getUptimeStats(db, mon.id, 30);

    expect(stats).toHaveLength(1);
    expect(stats[0].assertionId).toBe(assertion.id);
    expect(stats[0].uptimePct).toBe(100);
    expect(stats[0].eventName).toBe("Purchase");
    expect(stats[0].platform).toBe("ga4");
    expect(stats[0].lastDiagnosis).toBe("ok");
  });

  it("excludes rows outside time window", async () => {
    const db = testDb.db;
    await seedUser(db, "user-a", "a@example.com");

    const mon = await createMonitor(db, {
      userId: "user-a",
      name: "Meta Pixel Signup",
      url: "https://example.com/signup",
    });

    const step = await addFunnelStep(db, {
      monitorId: mon.id,
      actionType: "navigate",
      payload: { url: "https://example.com/signup" },
    });

    const assertion = await addEventAssertion(db, "user-a", {
      funnelStepId: step.id,
      platform: "meta_browser",
      eventName: "CompleteRegistration",
    });

    const now = new Date();
    // 40 days ago — outside a 30-day window
    const outside = new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000);

    // Seed 5 failed results OUTSIDE the window (should be excluded)
    for (let i = 0; i < 5; i++) {
      await seedResult(db, {
        monitorId: mon.id,
        assertionId: assertion.id,
        passed: false,
        createdAt: outside,
        diagnosisCode: "event_not_fired",
      });
    }

    // Seed 5 passed results INSIDE the window
    for (let i = 0; i < 5; i++) {
      await seedResult(db, {
        monitorId: mon.id,
        assertionId: assertion.id,
        passed: true,
        createdAt: now,
      });
    }

    const stats = await getUptimeStats(db, mon.id, 30);

    expect(stats).toHaveLength(1);
    // Only the 5 in-window rows count; all 5 passed → 100 %
    expect(stats[0].uptimePct).toBe(100);
    expect(stats[0].lastDiagnosis).toBe("ok");
  });

  it("returns empty array when no results exist", async () => {
    const db = testDb.db;
    await seedUser(db, "user-a", "a@example.com");

    const mon = await createMonitor(db, {
      userId: "user-a",
      name: "No Results Monitor",
      url: "https://example.com",
    });

    const stats = await getUptimeStats(db, mon.id, 30);
    expect(stats).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// getRecentRuns
// ---------------------------------------------------------------------------

describe("getRecentRuns", () => {
  it("returns at most limit rows ordered by startedAt DESC", async () => {
    const db = testDb.db;
    await seedUser(db, "user-a", "a@example.com");

    const mon = await createMonitor(db, {
      userId: "user-a",
      name: "GA4 Monitor",
      url: "https://example.com",
    });

    const now = new Date();
    for (let i = 0; i < 5; i++) {
      await db.insert(checkRun).values({
        id: crypto.randomUUID(),
        monitorId: mon.id,
        status: "passing",
        startedAt: new Date(now.getTime() + i * 1000),
        createdAt: new Date(now.getTime() + i * 1000),
      });
    }

    const runs = await getRecentRuns(db, mon.id, 3);
    expect(runs).toHaveLength(3);
    // Most recent first
    expect(runs[0].startedAt.getTime()).toBeGreaterThanOrEqual(
      runs[1].startedAt.getTime(),
    );
  });

  it("returns only runs for the given monitorId", async () => {
    const db = testDb.db;
    await seedUser(db, "user-a", "a@example.com");

    const [monA, monB] = await Promise.all([
      createMonitor(db, {
        userId: "user-a",
        name: "Monitor A",
        url: "https://a.example.com",
      }),
      createMonitor(db, {
        userId: "user-a",
        name: "Monitor B",
        url: "https://b.example.com",
      }),
    ]);

    const now = new Date();
    await db.insert(checkRun).values({
      id: crypto.randomUUID(),
      monitorId: monA.id,
      status: "passing",
      startedAt: now,
      createdAt: now,
    });
    await db.insert(checkRun).values({
      id: crypto.randomUUID(),
      monitorId: monB.id,
      status: "failed",
      startedAt: now,
      createdAt: now,
    });

    const runs = await getRecentRuns(db, monA.id, 10);
    expect(runs).toHaveLength(1);
    expect(runs[0].monitorId).toBe(monA.id);
  });
});
