/**
 * Per-assertion evaluation logic for the PixelPulse worker.
 *
 * Pure functions — no I/O, no Playwright dependency — so they can be unit
 * tested directly. The runner calls these after collecting InterceptedRequests
 * from the headless browser session.
 */

import type {
  AssertionSpec,
  CheckResult,
  DiagnosisCode,
  InterceptedRequest,
} from "./types";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Evaluate a single AssertionSpec against the full list of requests
 * intercepted during the funnel step.
 *
 * Evaluation order (first failing check wins):
 *  1. duplicate_fire  — more than one matching event detected
 *  2. missing_event   — zero matching events detected
 *  3. wrong_value     — value present but does not match expectedValue
 *  4. wrong_currency  — currency present but does not match expectedCurrency
 *  5. dedup_key_missing — spec requires a dedupKey but none was captured
 *  6. ok              — all specified checks passed
 *
 * NOTE: actualPayload is stored verbatim and must NEVER be logged to stdout
 * or included in API responses (PII may be present).
 */
export function checkAssertion(
  intercepted: InterceptedRequest[],
  spec: AssertionSpec,
): CheckResult {
  const base = {
    assertionId: spec.assertionId,
    platform: spec.platform,
    eventName: spec.eventName,
  } as const;

  // Filter to requests that match this assertion's platform + event name
  const matching = intercepted.filter(
    (r) =>
      r.platform === spec.platform && r.eventName === spec.eventName,
  );

  // 1. Duplicate fire — checked before missing so we diagnose correctly
  if (matching.length > 1) {
    return {
      ...base,
      passed: false,
      diagnosisCode: "duplicate_fire" satisfies DiagnosisCode,
      actualPayload: matching[0].payload,
    };
  }

  // 2. Missing event
  if (matching.length === 0) {
    return {
      ...base,
      passed: false,
      diagnosisCode: "missing_event" satisfies DiagnosisCode,
    };
  }

  const request = matching[0];

  // 3. Value mismatch
  if (
    spec.expectedValue !== undefined &&
    request.value !== spec.expectedValue
  ) {
    return {
      ...base,
      passed: false,
      diagnosisCode: "wrong_value" satisfies DiagnosisCode,
      actualPayload: request.payload,
    };
  }

  // 4. Currency mismatch
  if (
    spec.expectedCurrency !== undefined &&
    request.currency !== spec.expectedCurrency
  ) {
    return {
      ...base,
      passed: false,
      diagnosisCode: "wrong_currency" satisfies DiagnosisCode,
      actualPayload: request.payload,
    };
  }

  // 5. Missing dedup key
  if (spec.expectedDedupKey !== undefined && !request.dedupKey) {
    return {
      ...base,
      passed: false,
      diagnosisCode: "dedup_key_missing" satisfies DiagnosisCode,
      actualPayload: request.payload,
    };
  }

  // 6. All checks passed
  return {
    ...base,
    passed: true,
    diagnosisCode: "ok" satisfies DiagnosisCode,
    actualPayload: request.payload,
  };
}

/**
 * Run all assertions for a single funnel step and return their results.
 */
export function checkStepAssertions(
  intercepted: InterceptedRequest[],
  specs: AssertionSpec[],
): CheckResult[] {
  return specs.map((spec) => checkAssertion(intercepted, spec));
}
