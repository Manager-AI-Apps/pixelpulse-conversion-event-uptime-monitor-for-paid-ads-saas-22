/**
 * Integration tests for the worker/cron scheduling layer.
 *
 * Acceptance tests:
 * 1. cron route inserts check_run rows: schedulePendingRuns inserts pending
 *    check_run for due monitors and does NOT advance monitor.nextRunAt.
 * 2. worker poll query finds pending_retry after retryAfter: pollPendingJobs
 *    returns pending_retry jobs only once retryAfter timestamp has passed.
 */

import { beforeEach, afterEach, describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";

import type { Database } from "@/lib/db";
import { user, monitor, checkRun } from "@/lib/db/schema";
import { createTestDb } from "@/tests/helpers/test-db";
import { pollPendingJobs, schedulePendingRuns } from "@/lib/worker/index";

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
  await db.insert(user).values({
    id,
    name: "Test User",
    email: `${id}@example.com`,
  });
}

async function seedMonitor(
  db: Database,
  userId: string,
  opts: { nextRunAt?: Date | null } = {},
): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(monitor).values({
    id,
    userId,
    name: "Test Monitor",
    url: "https://example.com",
    nextRunAt: "nextRunAt" in opts ? opts.nextRunAt ?? null : null,
  });
  return id;
}

// ---------------------------------------------------------------------------
// Test 1: cron route inserts check_run rows
// ---------------------------------------------------------------------------

describe("cron route inserts check_run rows", () => {
  it(
    "inserts pending check_run for due monitors and does not advance nextRunAt",
    async () => {
      const db = testDb.db;
      await seedUser(db, "user-cron-1");

      const now = new Date("2026-06-01T12:00:00.000Z");
      const pastTime = new Date(now.getTime() - 60_000);   // 1 min before now
      const futureTime = new Date(now.getTime() + 60_000); // 1 min after now

      // Due: nextRunAt in the past
      const dueId = await seedMonitor(db, "user-cron-1", { nextRunAt: pastTime });
      // Due: nextRunAt null (schedule ASAP)
      const nullId = await seedMonitor(db, "user-cron-1", { nextRunAt: null });
      // Not due: nextRunAt in the future
      const futureId = await seedMonitor(db, "user-cron-1", { nextRunAt: futureTime });

      const count = await schedulePendingRuns(db, now);

      // 2 due monitors → 2 inserted check_runs
      expect(count).toBe(2);

      // Due-by-past-time monitor → has a pending check_run
      const runsForDue = await db
        .select()
        .from(checkRun)
        .where(eq(checkRun.monitorId, dueId));
      expect(runsForDue).toHaveLength(1);
      expect(runsForDue[0]!.status).toBe("pending");

      // Due-by-null monitor → has a pending check_run
      const runsForNull = await db
        .select()
        .from(checkRun)
        .where(eq(checkRun.monitorId, nullId));
      expect(runsForNull).toHaveLength(1);
      expect(runsForNull[0]!.status).toBe("pending");

      // Future monitor → no check_run created
      const runsForFuture = await db
        .select()
        .from(checkRun)
        .where(eq(checkRun.monitorId, futureId));
      expect(runsForFuture).toHaveLength(0);

      // monitor.nextRunAt must NOT be advanced by schedulePendingRuns
      const [dueMonAfter] = await db
        .select()
        .from(monitor)
        .where(eq(monitor.id, dueId));
      expect(dueMonAfter!.nextRunAt?.getTime()).toBe(pastTime.getTime());

      const [nullMonAfter] = await db
        .select()
        .from(monitor)
        .where(eq(monitor.id, nullId));
      expect(nullMonAfter!.nextRunAt).toBeNull();
    },
  );
});

// ---------------------------------------------------------------------------
// Test 2: worker poll query
// ---------------------------------------------------------------------------

describe("worker poll query finds pending_retry after retryAfter", () => {
  it(
    "returns pending_retry job only after retryAfter timestamp passes",
    async () => {
      const db = testDb.db;
      await seedUser(db, "user-poll-1");
      const monitorId = await seedMonitor(db, "user-poll-1");

      const baseTime = new Date("2026-01-01T12:00:00.000Z");
      const retryAfterTime = new Date(baseTime.getTime() + 5 * 60 * 1_000); // +5 min

      const runId = crypto.randomUUID();
      await db.insert(checkRun).values({
        id: runId,
        monitorId,
        status: "pending_retry",
        retryCount: 1,
        retryAfter: retryAfterTime,
      });

      // BEFORE retryAfter: job must NOT be returned
      const beforeJobs = await pollPendingJobs(db, baseTime);
      expect(beforeJobs).not.toContain(runId);

      // AFTER retryAfter: job must be returned
      const afterJobs = await pollPendingJobs(
        db,
        new Date(retryAfterTime.getTime() + 1_000),
      );
      expect(afterJobs).toContain(runId);
    },
  );

  it(
    "always returns plain pending jobs regardless of current time",
    async () => {
      const db = testDb.db;
      await seedUser(db, "user-poll-2");
      const monitorId = await seedMonitor(db, "user-poll-2");

      const runId = crypto.randomUUID();
      await db.insert(checkRun).values({
        id: runId,
        monitorId,
        status: "pending",
        retryCount: 0,
      });

      // Plain pending jobs are always included regardless of time
      const veryOldTime = new Date("2020-01-01T00:00:00.000Z");
      const jobs = await pollPendingJobs(db, veryOldTime);
      expect(jobs).toContain(runId);
    },
  );
});
