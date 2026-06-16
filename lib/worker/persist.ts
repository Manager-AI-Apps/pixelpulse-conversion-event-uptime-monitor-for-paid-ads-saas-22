/**
 * Persistence layer for the PixelPulse check-run worker.
 *
 * Two-transaction pattern:
 *   TX1  claimCheckRun  — atomically marks the run 'running' so no other worker
 *                         picks it up. monitor.nextRunAt is NOT touched yet.
 *   TX2  finalizeCheckRun — inserts eventAssertionResult rows, updates checkRun
 *                         status/retryCount, and advances monitor.nextRunAt only
 *                         on success or retry exhaustion.
 *
 * Retry logic (retryCount starts at 0):
 *   failure + newRetryCount < 2  → status='pending_retry', retryAfter=+5min
 *   failure + newRetryCount >= 2 → status='failed', advance nextRunAt, alert Slack
 */

import { and, eq, or } from "drizzle-orm";

import { db as defaultDb } from "@/lib/db";
import type { Database } from "@/lib/db";
import { checkRun, eventAssertionResult, monitor } from "@/lib/db/schema";
import type { DiagnosisCode, RunResult } from "./types";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Called by finalizeCheckRun when a monitor's run has permanently failed
 * (retries exhausted). Callers should send the message to the monitor's
 * configured Slack webhook.
 */
export type SlackAlerter = (params: {
  monitorId: string;
  message: string;
  webhookUrl: string;
}) => Promise<void>;

// ---------------------------------------------------------------------------
// Internal: diagnosis code mapping
// ---------------------------------------------------------------------------

/**
 * Worker DiagnosisCode values differ from the DB diagnosisCodeEnum values.
 * This mapper translates between them.
 */
type DbDiagnosisCode = typeof import("@/lib/db/schema").diagnosisCodeEnum.enumValues[number];

const DIAGNOSIS_MAP: Record<DiagnosisCode, DbDiagnosisCode> = {
  ok: "ok",
  missing_event: "event_not_fired",
  wrong_value: "value_mismatch",
  wrong_currency: "currency_mismatch",
  duplicate_fire: "duplicate_via_gtag_gtm",
  dedup_key_missing: "dedup_key_missing",
};

function mapDiagnosisCode(code: DiagnosisCode): DbDiagnosisCode {
  return DIAGNOSIS_MAP[code] ?? "event_not_fired";
}

// ---------------------------------------------------------------------------
// TX1: Claim a pending (or pending_retry) check run
// ---------------------------------------------------------------------------

/**
 * Atomically claims a check_run for execution by transitioning its status
 * from 'pending' or 'pending_retry' to 'running' and recording startedAt=now().
 *
 * Returns `true` if the row was successfully claimed by this call.
 * Returns `false` if the run was not found or had already been claimed by
 * another worker (optimistic concurrency).
 */
export async function claimCheckRun(
  db: Database = defaultDb,
  checkRunId: string,
): Promise<boolean> {
  if (!checkRunId) throw new Error("checkRunId is required");

  const now = new Date();

  const updated = await db
    .update(checkRun)
    .set({ status: "running", startedAt: now })
    .where(
      and(
        eq(checkRun.id, checkRunId),
        or(
          eq(checkRun.status, "pending"),
          eq(checkRun.status, "pending_retry"),
        ),
      ),
    )
    .returning({ id: checkRun.id });

  return updated.length > 0;
}

// ---------------------------------------------------------------------------
// TX2: Finalize a running check run
// ---------------------------------------------------------------------------

/**
 * Finalizes a check run after the worker has executed the funnel replay:
 *
 * 1. Inserts an eventAssertionResult row for each CheckResult that carries
 *    an assertionId (which is the corresponding eventAssertion.id in the DB).
 *    No monitorId is denormalized — the join path is:
 *    eventAssertionResult → checkRun → monitor.
 *
 * 2. Updates check_run:
 *    - passed   → status='passing', finishedAt=now(), diagnosisCode mapped
 *    - retry    → status='pending_retry', retryCount++, retryAfter=now()+5min
 *    - exhausted → status='failed', finishedAt=now(), retryCount++
 *
 * 3. Advances monitor.nextRunAt by intervalMinutes only on success or
 *    retry exhaustion (i.e. NOT on a pending_retry transition).
 *
 * 4. Calls `alerter` with the monitor's slackWebhookUrl when status becomes
 *    'failed' (if alerter is provided and the monitor has a webhook configured).
 *
 * @throws Error if checkRunId or its parent monitor cannot be found.
 */
export async function finalizeCheckRun(
  db: Database = defaultDb,
  input: {
    checkRunId: string;
    result: RunResult;
  },
  alerter?: SlackAlerter,
): Promise<void> {
  const { checkRunId, result } = input;

  if (!checkRunId) throw new Error("checkRunId is required");

  // Load current run state (retryCount + monitorId)
  const [run] = await db
    .select({
      id: checkRun.id,
      monitorId: checkRun.monitorId,
      retryCount: checkRun.retryCount,
    })
    .from(checkRun)
    .where(eq(checkRun.id, checkRunId));

  if (!run) throw new Error(`checkRun not found: ${checkRunId}`);

  // Load monitor (intervalMinutes + slackWebhookUrl)
  const [mon] = await db
    .select({
      id: monitor.id,
      intervalMinutes: monitor.intervalMinutes,
      slackWebhookUrl: monitor.slackWebhookUrl,
    })
    .from(monitor)
    .where(eq(monitor.id, run.monitorId));

  if (!mon) throw new Error(`monitor not found for checkRun: ${checkRunId}`);

  const now = new Date();
  const diagCode = mapDiagnosisCode(result.diagnosisCode);

  // Decide outcome
  const isPassed = result.passed;
  const newRetryCount = run.retryCount + (isPassed ? 0 : 1);
  // "retry exhausted" when the newly-incremented count reaches 2
  const isRetryExhausted = !isPassed && newRetryCount >= 2;
  const isPendingRetry = !isPassed && newRetryCount < 2;

  // ── Step 1: Insert per-assertion result rows ──────────────────────────────

  const resultsToInsert = result.checkResults.filter(
    (cr): cr is typeof cr & { assertionId: string } => !!cr.assertionId,
  );

  if (resultsToInsert.length > 0) {
    await db.insert(eventAssertionResult).values(
      resultsToInsert.map((cr) => ({
        id: crypto.randomUUID(),
        checkRunId,
        eventAssertionId: cr.assertionId,
        passed: cr.passed,
        diagnosisCode: mapDiagnosisCode(cr.diagnosisCode),
        capturedPayload: (cr.actualPayload ?? null) as Record<string, unknown> | null,
      })),
    );
  }

  // ── Step 2: Update check_run ──────────────────────────────────────────────

  const newStatus = isPassed
    ? ("passing" as const)
    : isPendingRetry
      ? ("pending_retry" as const)
      : ("failed" as const);

  await db
    .update(checkRun)
    .set({
      status: newStatus,
      diagnosisCode: diagCode,
      retryCount: newRetryCount,
      retryAfter: isPendingRetry
        ? new Date(now.getTime() + 5 * 60 * 1000)
        : null,
      finishedAt: !isPendingRetry ? now : null,
    })
    .where(eq(checkRun.id, checkRunId));

  // ── Step 3: Advance monitor.nextRunAt (only on passed or exhausted) ───────

  if (isPassed || isRetryExhausted) {
    const nextRunAt = new Date(now.getTime() + mon.intervalMinutes * 60 * 1000);
    await db
      .update(monitor)
      .set({ nextRunAt })
      .where(eq(monitor.id, mon.id));
  }

  // ── Step 4: Trigger Slack alert on final failure ──────────────────────────

  if (isRetryExhausted && alerter && mon.slackWebhookUrl) {
    const failedResults = result.checkResults.filter((cr) => !cr.passed);
    const message =
      failedResults.length > 0
        ? failedResults
            .map((cr) => `[${cr.platform}] ${cr.eventName}: ${cr.diagnosisCode}`)
            .join("; ")
        : "Check run failed with no matching events.";

    await alerter({
      monitorId: mon.id,
      message,
      webhookUrl: mon.slackWebhookUrl,
    });
  }
}
