/**
 * Shared types for the PixelPulse worker (funnel replay & event assertions).
 *
 * These types are intentionally decoupled from the Drizzle DB schema so the
 * worker can run as a standalone Node process without pulling in the full app
 * dependency graph.
 */

// ---------------------------------------------------------------------------
// Platforms
// ---------------------------------------------------------------------------

/**
 * Tracking platform whose network requests the runner intercepts.
 * - ga4          : Google Analytics 4 (gtag/collect endpoint)
 * - meta_browser : Meta Pixel browser-side (facebook.com/tr)
 * - meta_capi    : Meta Conversions API (graph.facebook.com/…/events)
 * - stripe       : Stripe Purchase event (r.stripe.com)
 */
export type Platform = "ga4" | "meta_browser" | "meta_capi" | "stripe";

// ---------------------------------------------------------------------------
// Diagnosis codes
// ---------------------------------------------------------------------------

/**
 * Per-assertion result codes returned by the worker.
 * These map to human-readable Slack alert copy.
 */
export type DiagnosisCode =
  | "ok"
  | "missing_event"
  | "wrong_value"
  | "wrong_currency"
  | "duplicate_fire"
  | "dedup_key_missing";

// ---------------------------------------------------------------------------
// Intercepted request (raw network capture)
// ---------------------------------------------------------------------------

/**
 * A single network request captured by the Playwright page.route() handler.
 * Platforms are detected by URL pattern; event name & properties are
 * parsed from the request URL / POST body.
 *
 * NOTE: actualPayload is stored verbatim — PII scrubbing is deferred to v2.
 * Never log payloads to stdout or expose them in API responses.
 */
export interface InterceptedRequest {
  /** Full request URL (used for platform detection) */
  url: string;
  /** Detected tracking platform */
  platform: Platform;
  /** Event name parsed from the request (e.g. "purchase", "Purchase") */
  eventName: string;
  /** ISO 4217 currency code, if present */
  currency?: string;
  /** Numeric conversion value, if present */
  value?: number;
  /**
   * Deduplication key (GA4: "transaction_id", Meta Pixel: "event_id",
   * Meta CAPI: "event_id", Stripe: charge/payment_intent id)
   */
  dedupKey?: string;
  /** Raw parsed payload — not forwarded to clients or logged */
  payload: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Assertion specification (from the founder's recorded funnel)
// ---------------------------------------------------------------------------

/**
 * Declares what the founder expects to see fired at a given funnel step.
 */
export interface AssertionSpec {
  /** Optional identity for correlation with DB eventAssertion row */
  assertionId?: string;
  /** Platform that should fire the event */
  platform: Platform;
  /** Expected event name (case-sensitive) */
  eventName: string;
  /** Expected ISO 4217 currency, if applicable */
  expectedCurrency?: string;
  /** Expected numeric conversion value, if applicable */
  expectedValue?: number;
  /** Expected deduplication key value, if applicable */
  expectedDedupKey?: string;
}

// ---------------------------------------------------------------------------
// Per-assertion check result
// ---------------------------------------------------------------------------

export interface CheckResult {
  /** Mirrors AssertionSpec.assertionId when present */
  assertionId?: string;
  platform: Platform;
  eventName: string;
  passed: boolean;
  diagnosisCode: DiagnosisCode;
  /**
   * Raw payload from the first matching intercepted request.
   * Present when at least one matching request was found.
   * Never returned to API clients; stored only in the DB capturedPayload col.
   */
  actualPayload?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Funnel step (replayed by the runner)
// ---------------------------------------------------------------------------

/**
 * A single user-interaction step recorded from the Chrome extension playback.
 */
export interface FunnelStepSpec {
  /** Zero-based index within the funnel */
  stepOrder: number;
  actionType: "navigate" | "click" | "fill" | "wait" | "submit";
  /** Serialized selector / URL / fill value (actionType-specific) */
  payload: Record<string, unknown>;
  /** Assertions to evaluate after this step completes */
  assertions: AssertionSpec[];
}

// ---------------------------------------------------------------------------
// Runner configuration & output
// ---------------------------------------------------------------------------

export interface RunnerConfig {
  /** Funnel steps to replay in order */
  steps: FunnelStepSpec[];
  /** Per-step timeout in milliseconds (default: 10_000) */
  stepTimeoutMs?: number;
  /** Overall run timeout in milliseconds (default: 60_000) */
  runTimeoutMs?: number;
}

export interface RunResult {
  /** True iff every assertion across every step passed */
  passed: boolean;
  /** Flat list of per-assertion outcomes across all steps */
  checkResults: CheckResult[];
  /**
   * Worst-case diagnosis code (first failure wins, or "ok" if all pass).
   * Used as the checkRun.diagnosisCode stored in the DB.
   */
  diagnosisCode: DiagnosisCode;
  /** Human-readable error message when the run itself crashed (not an assertion failure) */
  error?: string;
}
