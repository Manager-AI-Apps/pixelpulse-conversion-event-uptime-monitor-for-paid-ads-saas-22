/**
 * PixelPulse worker core: job queue polling, monitor scheduling, and the
 * run cycle that ties together the funnel runner and persistence layer.
 *
 * Public surface (all db-injectable for tests):
 *   pollPendingJobs(db?, now?)       — IDs of check_run rows ready to process
 *   schedulePendingRuns(db?, now?)   — Creates check_run rows for due monitors
 *   runWorkerCycle(pageFactory, db?) — Processes one batch of pending jobs
 *
 * NOTE: Playwright is NOT imported in this module. The caller provides a
 * PageFactory that returns a Playwright-compatible PageLike. This keeps the
 * module importable in the test environment without browser binaries.
 */

import { and, asc, eq, isNull, lte, ne, or } from "drizzle-orm";

import { db as defaultDb } from "@/lib/db";
import type { Database } from "@/lib/db";
import { checkRun, eventAssertion, funnelStep, monitor } from "@/lib/db/schema";
import { claimCheckRun, finalizeCheckRun } from "./persist";
import { replayFunnel } from "./runner";
import type { PageLike } from "./runner";
import type {
  AssertionSpec,
  CheckResult,
  FunnelStepSpec,
  Platform,
  RunnerConfig,
  RunResult,
} from "./types";
import { sendSlackAlert } from "./slack";

// ---------------------------------------------------------------------------
// Platform guard (DB enum has google_ads; worker Platform type does not)
// ---------------------------------------------------------------------------

const RUNNER_PLATFORMS = new Set<Platform>([
  "ga4",
  "meta_browser",
  "meta_capi",
  "stripe",
]);

function isRunnerPlatform(p: string): p is Platform {
  return RUNNER_PLATFORMS.has(p as Platform);
}

// ---------------------------------------------------------------------------
// Queue polling
// ---------------------------------------------------------------------------

/**
 * Returns IDs of check_run rows that are ready to be processed:
 *   - status = 'pending'   (always ready, no delay)
 *   - status = 'pending_retry' AND (retryAfter IS NULL OR retryAfter <= now)
 *
 * @param db  - Drizzle db (defaults to app db)
 * @param now - Current time for retryAfter comparison (injectable for tests)
 */
export async function pollPendingJobs(
  db: Database = defaultDb,
  now: Date = new Date(),
): Promise<string[]> {
  const rows = await db
    .select({ id: checkRun.id })
    .from(checkRun)
    .where(
      or(
        eq(checkRun.status, "pending"),
        and(
          eq(checkRun.status, "pending_retry"),
          or(isNull(checkRun.retryAfter), lte(checkRun.retryAfter, now)),
        ),
      ),
    );

  return rows.map((r) => r.id);
}

// ---------------------------------------------------------------------------
// Monitor scheduling (cron trigger)
// ---------------------------------------------------------------------------

/**
 * Creates check_run rows (status='pending') for every non-paused, due monitor.
 * Due = nextRunAt IS NULL OR nextRunAt <= now.
 * Does NOT advance monitor.nextRunAt — that is finalizeCheckRun's responsibility.
 *
 * @param db  - Drizzle db (defaults to app db)
 * @param now - Current time for nextRunAt comparison (injectable for tests)
 * @returns Number of check_run rows inserted.
 */
export async function schedulePendingRuns(
  db: Database = defaultDb,
  now: Date = new Date(),
): Promise<number> {
  const dueMonitors = await db
    .select({ id: monitor.id })
    .from(monitor)
    .where(
      and(
        ne(monitor.status, "paused"),
        or(isNull(monitor.nextRunAt), lte(monitor.nextRunAt, now)),
      ),
    );

  if (dueMonitors.length === 0) return 0;

  await db.insert(checkRun).values(
    dueMonitors.map((m) => ({
      id: crypto.randomUUID(),
      monitorId: m.id,
      status: "pending" as const,
      retryCount: 0,
    })),
  );

  return dueMonitors.length;
}

// ---------------------------------------------------------------------------
// Runner config builder (internal)
// ---------------------------------------------------------------------------

/**
 * Loads a RunnerConfig from the DB for the check run's parent monitor.
 * Fetches all funnel steps and their event assertions in two queries.
 *
 * @throws Error if the check run or its parent monitor cannot be found.
 */
async function buildRunnerConfig(
  db: Database,
  checkRunId: string,
): Promise<RunnerConfig> {
  // 1. Resolve checkRun → monitorId
  const [run] = await db
    .select({ monitorId: checkRun.monitorId })
    .from(checkRun)
    .where(eq(checkRun.id, checkRunId));

  if (!run) throw new Error(`checkRun not found: ${checkRunId}`);

  // 2. Load steps + assertions via a left join (one round trip)
  const rows = await db
    .select({
      stepId: funnelStep.id,
      stepOrder: funnelStep.stepOrder,
      actionType: funnelStep.actionType,
      payload: funnelStep.payload,
      assertionId: eventAssertion.id,
      platform: eventAssertion.platform,
      eventName: eventAssertion.eventName,
      expectedCurrency: eventAssertion.expectedCurrency,
      expectedProps: eventAssertion.expectedProps,
    })
    .from(funnelStep)
    .leftJoin(eventAssertion, eq(eventAssertion.funnelStepId, funnelStep.id))
    .where(eq(funnelStep.monitorId, run.monitorId))
    .orderBy(asc(funnelStep.stepOrder));

  // Group rows by stepId to build FunnelStepSpec[]
  const stepMap = new Map<string, FunnelStepSpec>();

  for (const row of rows) {
    if (!stepMap.has(row.stepId)) {
      stepMap.set(row.stepId, {
        stepOrder: row.stepOrder,
        actionType: row.actionType,
        payload: (row.payload ?? {}) as Record<string, unknown>,
        assertions: [],
      });
    }

    const step = stepMap.get(row.stepId)!;

    if (row.assertionId !== null && row.platform !== null && row.eventName !== null) {
      if (!isRunnerPlatform(row.platform)) {
        // google_ads is not yet supported by the runner
        continue;
      }

      const props = (row.expectedProps ?? null) as Record<string, unknown> | null;
      const spec: AssertionSpec = {
        assertionId: row.assertionId,
        platform: row.platform,
        eventName: row.eventName,
        expectedCurrency: row.expectedCurrency ?? undefined,
        expectedValue:
          typeof props?.["value"] === "number" ? props["value"] : undefined,
        expectedDedupKey:
          typeof props?.["dedupKey"] === "string" ? props["dedupKey"] : undefined,
      };
      step.assertions.push(spec);
    }
  }

  return { steps: Array.from(stepMap.values()) };
}

// ---------------------------------------------------------------------------
// Page factory type
// ---------------------------------------------------------------------------

/** Factory that returns a fresh Playwright-compatible page for a run. */
export type PageFactory = () => Promise<PageLike>;

// ---------------------------------------------------------------------------
// Worker cycle
// ---------------------------------------------------------------------------

/**
 * Processes one polling batch of pending check_run jobs:
 *   1. Polls for due jobs via pollPendingJobs.
 *   2. For each job: claims it (optimistic lock), builds RunnerConfig,
 *      replays the funnel on the provided page, then finalizes the run.
 *   3. Sends Slack alert on final failure via finalizeCheckRun's alerter hook.
 *
 * Jobs are processed sequentially to avoid overloading the worker host.
 *
 * @param createPage - Factory that creates a fresh Playwright-compatible page.
 *                     The caller is responsible for browser lifecycle; the page
 *                     is closed after each job (pass or fail).
 * @param db         - Drizzle db (defaults to app db)
 */
export async function runWorkerCycle(
  createPage: PageFactory,
  db: Database = defaultDb,
): Promise<void> {
  const now = new Date();
  const jobIds = await pollPendingJobs(db, now);

  for (const jobId of jobIds) {
    // Claim the run to prevent double-processing by concurrent workers
    const claimed = await claimCheckRun(db, jobId);
    if (!claimed) continue;

    // Default failure result — overwritten on successful run
    let result: RunResult = {
      passed: false,
      checkResults: [] as CheckResult[],
      diagnosisCode: "missing_event",
      error: "Worker initialization error",
    };

    let page: PageLike | null = null;

    try {
      page = await createPage();
      const config = await buildRunnerConfig(db, jobId);
      result = await replayFunnel(page, config);
    } catch (err) {
      result = {
        passed: false,
        checkResults: [] as CheckResult[],
        diagnosisCode: "missing_event",
        error: err instanceof Error ? err.message : String(err),
      };
    } finally {
      if (page !== null) {
        // Best-effort page close; ignore teardown errors
        await page.close().catch((closeErr: unknown) => {
          console.error(`[worker] page.close() failed for job ${jobId}:`, closeErr);
        });
      }
    }

    try {
      const capturedResult = result;
      await finalizeCheckRun(
        db,
        { checkRunId: jobId, result: capturedResult },
        async ({ monitorId, message, webhookUrl }) => {
          await sendSlackAlert({
            webhookUrl,
            diagnosisCode: capturedResult.diagnosisCode,
            monitorId,
            message,
          });
        },
      );
    } catch (err) {
      console.error(`[worker] finalizeCheckRun failed for job ${jobId}:`, err);
    }
  }
}
