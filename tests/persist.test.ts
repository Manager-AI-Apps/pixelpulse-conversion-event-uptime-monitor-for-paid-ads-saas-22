/**
 * Integration tests for lib/worker/persist.ts
 *
 * Acceptance tests:
 * 1. nextRunAt not advanced until run completes:
 *    - after TX1 claim, monitor.nextRunAt unchanged
 *    - after TX2 success, nextRunAt = now()+15min
 * 2. retry sets pending_retry status:
 *    - first failure sets status=pending_retry, retryCount=1, retryAfter=+5min
 *    - second failure sets status=failed
 */

import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { eq } from "drizzle-orm";

import { createTestDb } from "@/tests/helpers/test-db";
import type { Database } from "@/lib/db";
import { user, monitor, checkRun } from "@/lib/db/schema";
import { claimCheckRun, finalizeCheckRun } from "@/lib/worker/persist";
import type { RunResult } from "@/lib/worker/types";

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

let testDb: Awaited<ReturnType<typeof createTestDb>>;

beforeEach(async () => {
  testDb = await createTestDb();
});

afterEach(async () => {
  await testDb.close();
});

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

async function seedUser(db: Database, id: string): Promise<void> {
  await db.insert(user).values({ id, name: "Test User", email: `${id}@example.com` });
}

async function seedMonitor(
  db: Database,
  userId: string,
  opts: { intervalMinutes?: number; slackWebhookUrl?: string } = {},
): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(monitor).values({
    id,
    userId,
    name: "Test Monitor",
    url: "https://example.com",
    intervalMinutes: opts.intervalMinutes ?? 15,
    slackWebhookUrl: opts.slackWebhookUrl ?? null,
  });
  return id;
}

async function seedCheckRun(
  db: Database,
  monitorId: string,
  opts: { retryCount?: number } = {},
): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(checkRun).values({
    id,
    monitorId,
    status: "pending",
    retryCount: opts.retryCount ?? 0,
  });
  return id;
}

// ---------------------------------------------------------------------------
// Shared result fixtures
// ---------------------------------------------------------------------------

const SUCCESS_RESULT: RunResult = {
  passed: true,
  checkResults: [],
  diagnosisCode: "ok",
};

const FAILURE_RESULT: RunResult = {
  passed: false,
  checkResults: [],
  diagnosisCode: "missing_event",
};

// ---------------------------------------------------------------------------
// Acceptance test 1: nextRunAt not advanced until run completes
// ---------------------------------------------------------------------------

describe("nextRunAt not advanced until run completes", () => {
  it("after TX1 claim, monitor.nextRunAt unchanged; after TX2 success, nextRunAt ≈ now()+15min", async () => {
    const db = testDb.db;
    await seedUser(db, "user-a");
    const monitorId = await seedMonitor(db, "user-a", { intervalMinutes: 15 });
    const checkRunId = await seedCheckRun(db, monitorId);

    // Verify nextRunAt is null before any action
    const [before] = await db.select().from(monitor).where(eq(monitor.id, monitorId));
    expect(before.nextRunAt).toBeNull();

    // TX1: claim the check run
    const claimed = await claimCheckRun(db, checkRunId);
    expect(claimed).toBe(true);

    // After TX1: nextRunAt must still be null (not advanced yet)
    const [afterTx1] = await db.select().from(monitor).where(eq(monitor.id, monitorId));
    expect(afterTx1.nextRunAt).toBeNull();

    // Verify check run is now 'running'
    const [runAfterTx1] = await db.select().from(checkRun).where(eq(checkRun.id, checkRunId));
    expect(runAfterTx1.status).toBe("running");

    // TX2: finalize with success
    const before2 = Date.now();
    await finalizeCheckRun(db, { checkRunId, result: SUCCESS_RESULT });
    const after2 = Date.now();

    // After TX2: nextRunAt must be set to approximately now() + 15 min
    const [afterTx2] = await db.select().from(monitor).where(eq(monitor.id, monitorId));
    expect(afterTx2.nextRunAt).not.toBeNull();

    const expectedMin = new Date(before2 + 15 * 60 * 1000);
    const expectedMax = new Date(after2 + 15 * 60 * 1000);
    const actual = afterTx2.nextRunAt!;
    expect(actual.getTime()).toBeGreaterThanOrEqual(expectedMin.getTime());
    expect(actual.getTime()).toBeLessThanOrEqual(expectedMax.getTime());

    // Check run should be 'passing'
    const [runAfterTx2] = await db.select().from(checkRun).where(eq(checkRun.id, checkRunId));
    expect(runAfterTx2.status).toBe("passing");
  });
});

// ---------------------------------------------------------------------------
// Acceptance test 2: retry sets pending_retry status
// ---------------------------------------------------------------------------

describe("retry sets pending_retry status", () => {
  it("first failure → pending_retry, retryCount=1, retryAfter≈+5min; second failure → failed", async () => {
    const db = testDb.db;
    await seedUser(db, "user-b");
    const monitorId = await seedMonitor(db, "user-b", {
      intervalMinutes: 15,
      slackWebhookUrl: "https://hooks.slack.com/test-webhook",
    });
    const checkRunId = await seedCheckRun(db, monitorId);

    const slackAlerter = vi.fn().mockResolvedValue(undefined);

    // ── First attempt ──────────────────────────────────────────────────────

    const claimed1 = await claimCheckRun(db, checkRunId);
    expect(claimed1).toBe(true);

    const beforeFirstFinalize = Date.now();
    await finalizeCheckRun(db, { checkRunId, result: FAILURE_RESULT }, slackAlerter);
    const afterFirstFinalize = Date.now();

    const [afterFirst] = await db.select().from(checkRun).where(eq(checkRun.id, checkRunId));

    // Status should be pending_retry
    expect(afterFirst.status).toBe("pending_retry");
    // retryCount incremented to 1
    expect(afterFirst.retryCount).toBe(1);
    // retryAfter ≈ now + 5 min
    expect(afterFirst.retryAfter).not.toBeNull();
    const expectedRetryAfterMin = new Date(beforeFirstFinalize + 5 * 60 * 1000);
    const expectedRetryAfterMax = new Date(afterFirstFinalize + 5 * 60 * 1000);
    expect(afterFirst.retryAfter!.getTime()).toBeGreaterThanOrEqual(expectedRetryAfterMin.getTime());
    expect(afterFirst.retryAfter!.getTime()).toBeLessThanOrEqual(expectedRetryAfterMax.getTime());

    // monitor.nextRunAt must NOT be advanced after first failure
    const [monAfterFirst] = await db.select().from(monitor).where(eq(monitor.id, monitorId));
    expect(monAfterFirst.nextRunAt).toBeNull();

    // Slack NOT called after first failure
    expect(slackAlerter).not.toHaveBeenCalled();

    // ── Second attempt ─────────────────────────────────────────────────────

    // Claim the pending_retry run for the retry attempt
    const claimed2 = await claimCheckRun(db, checkRunId);
    expect(claimed2).toBe(true);

    const beforeSecondFinalize = Date.now();
    await finalizeCheckRun(db, { checkRunId, result: FAILURE_RESULT }, slackAlerter);
    const afterSecondFinalize = Date.now();

    const [afterSecond] = await db.select().from(checkRun).where(eq(checkRun.id, checkRunId));

    // Status should be failed
    expect(afterSecond.status).toBe("failed");
    // retryCount incremented to 2
    expect(afterSecond.retryCount).toBe(2);

    // monitor.nextRunAt must be advanced after retry exhaustion
    const [monAfterSecond] = await db.select().from(monitor).where(eq(monitor.id, monitorId));
    expect(monAfterSecond.nextRunAt).not.toBeNull();
    const expectedNextMin = new Date(beforeSecondFinalize + 15 * 60 * 1000);
    const expectedNextMax = new Date(afterSecondFinalize + 15 * 60 * 1000);
    expect(monAfterSecond.nextRunAt!.getTime()).toBeGreaterThanOrEqual(expectedNextMin.getTime());
    expect(monAfterSecond.nextRunAt!.getTime()).toBeLessThanOrEqual(expectedNextMax.getTime());

    // Slack alert triggered once on final failure
    expect(slackAlerter).toHaveBeenCalledTimes(1);
    expect(slackAlerter).toHaveBeenCalledWith(
      expect.objectContaining({
        monitorId,
        webhookUrl: "https://hooks.slack.com/test-webhook",
      }),
    );
  });
});
