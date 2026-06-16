/**
 * Uptime statistics queries for PixelPulse.
 *
 * - getUptimeStats: per-assertion pass-rate over a rolling day window.
 * - getRecentRuns:  last N check_runs for a monitor, ordered newest-first.
 *
 * Pass `db` explicitly in tests (createTestDb().db); rely on the default `db`
 * import from `@/lib/db` in production.
 */

import { and, desc, eq, gte } from "drizzle-orm";

import { db as defaultDb } from "@/lib/db";
import type { Database } from "@/lib/db";
import {
  checkRun,
  eventAssertion,
  eventAssertionResult,
} from "@/lib/db/schema";

// ---------------------------------------------------------------------------
// Return types
// ---------------------------------------------------------------------------

/** One row per event assertion, aggregated over the given day window. */
export interface UptimeStat {
  assertionId: string;
  eventName: string;
  platform: typeof eventAssertion.$inferSelect["platform"];
  /** Percentage of results that passed (0-100, integer). */
  uptimePct: number;
  /** Diagnosis code of the most recent result in the window. */
  lastDiagnosis: typeof eventAssertionResult.$inferSelect["diagnosisCode"];
}

/** Lightweight check-run row for the history list. */
export type RecentRun = Pick<
  typeof checkRun.$inferSelect,
  | "id"
  | "monitorId"
  | "status"
  | "startedAt"
  | "finishedAt"
  | "diagnosisCode"
  | "createdAt"
>;

// ---------------------------------------------------------------------------
// getUptimeStats
// ---------------------------------------------------------------------------

/**
 * Return per-assertion uptime statistics for `monitorId` over the last `days`
 * calendar days.
 *
 * The cutoff is computed as `Date.now() - days * 24h` so the window is
 * evaluated in the application layer — equivalent to PostgreSQL's
 * `NOW() - make_interval(days => $days)` but without Drizzle raw SQL.
 *
 * Rows are grouped client-side after a single JOIN query so we avoid complex
 * aggregate SQL while staying fully typed.
 */
export async function getUptimeStats(
  db: Database = defaultDb,
  monitorId: string,
  days: number,
): Promise<UptimeStat[]> {
  if (!monitorId) throw new Error("monitorId is required");
  if (days <= 0) throw new Error("days must be positive");

  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      assertionId: eventAssertionResult.eventAssertionId,
      eventName: eventAssertion.eventName,
      platform: eventAssertion.platform,
      passed: eventAssertionResult.passed,
      diagnosisCode: eventAssertionResult.diagnosisCode,
      createdAt: eventAssertionResult.createdAt,
    })
    .from(eventAssertionResult)
    .innerJoin(checkRun, eq(eventAssertionResult.checkRunId, checkRun.id))
    .innerJoin(
      eventAssertion,
      eq(eventAssertionResult.eventAssertionId, eventAssertion.id),
    )
    .where(
      and(
        eq(checkRun.monitorId, monitorId),
        gte(eventAssertionResult.createdAt, cutoff),
      ),
    );

  if (rows.length === 0) return [];

  // Group by assertionId in JavaScript — avoids complex SQL aggregates while
  // remaining fully typed.
  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const bucket = groups.get(row.assertionId);
    if (bucket) {
      bucket.push(row);
    } else {
      groups.set(row.assertionId, [row]);
    }
  }

  return Array.from(groups.entries()).map(([assertionId, results]) => {
    const total = results.length;
    const passedCount = results.filter((r) => r.passed).length;
    const uptimePct = total > 0 ? Math.round((passedCount / total) * 100) : 0;

    // Most-recent result supplies eventName, platform, and lastDiagnosis.
    const sorted = results
      .slice()
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const last = sorted[0]!;

    return {
      assertionId,
      eventName: last.eventName,
      platform: last.platform,
      uptimePct,
      lastDiagnosis: last.diagnosisCode,
    } satisfies UptimeStat;
  });
}

// ---------------------------------------------------------------------------
// getRecentRuns
// ---------------------------------------------------------------------------

/**
 * Return the last `limit` check_runs for `monitorId`, ordered by startedAt
 * descending (most recent first).
 */
export async function getRecentRuns(
  db: Database = defaultDb,
  monitorId: string,
  limit: number,
): Promise<RecentRun[]> {
  if (!monitorId) throw new Error("monitorId is required");
  if (limit <= 0) throw new Error("limit must be positive");

  return db
    .select({
      id: checkRun.id,
      monitorId: checkRun.monitorId,
      status: checkRun.status,
      startedAt: checkRun.startedAt,
      finishedAt: checkRun.finishedAt,
      diagnosisCode: checkRun.diagnosisCode,
      createdAt: checkRun.createdAt,
    })
    .from(checkRun)
    .where(eq(checkRun.monitorId, monitorId))
    .orderBy(desc(checkRun.startedAt))
    .limit(limit);
}
