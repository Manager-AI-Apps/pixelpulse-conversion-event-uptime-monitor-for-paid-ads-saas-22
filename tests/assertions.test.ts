/**
 * Unit tests for lib/worker/assertions.ts
 *
 * Tests cover the three core diagnosis codes emitted by checkAssertion():
 *   - missing_event  : no matching intercepted request found
 *   - wrong_value    : value in intercepted request does not match expectedValue
 *   - duplicate_fire : the same event name fires more than once
 */

import { describe, it, expect } from "vitest";
import { checkAssertion } from "@/lib/worker/assertions";
import type { AssertionSpec, InterceptedRequest } from "@/lib/worker/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGA4Request(overrides?: Partial<InterceptedRequest>): InterceptedRequest {
  return {
    url: "https://www.google-analytics.com/g/collect?en=purchase",
    platform: "ga4",
    eventName: "purchase",
    currency: "USD",
    value: 99.0,
    dedupKey: "txn-001",
    payload: {},
    ...overrides,
  };
}

function makeSpec(overrides?: Partial<AssertionSpec>): AssertionSpec {
  return {
    platform: "ga4",
    eventName: "purchase",
    expectedCurrency: "USD",
    expectedValue: 99.0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// missing_event
// ---------------------------------------------------------------------------

describe("checkAssertion — missing_event", () => {
  it("returns diagnosisCode=missing_event when intercepted list is empty", () => {
    const result = checkAssertion([], makeSpec());
    expect(result.passed).toBe(false);
    expect(result.diagnosisCode).toBe("missing_event");
  });

  it("returns missing_event when no requests match the platform", () => {
    const request = makeGA4Request({ platform: "meta_browser" });
    const result = checkAssertion([request], makeSpec({ platform: "ga4" }));
    expect(result.passed).toBe(false);
    expect(result.diagnosisCode).toBe("missing_event");
  });

  it("returns missing_event when no requests match the eventName", () => {
    const request = makeGA4Request({ eventName: "page_view" });
    const result = checkAssertion([request], makeSpec({ eventName: "purchase" }));
    expect(result.passed).toBe(false);
    expect(result.diagnosisCode).toBe("missing_event");
  });
});

// ---------------------------------------------------------------------------
// wrong_value
// ---------------------------------------------------------------------------

describe("checkAssertion — wrong_value", () => {
  it("returns diagnosisCode=wrong_value when intercepted value differs from expectedValue", () => {
    const request = makeGA4Request({ value: 50.0 });
    const result = checkAssertion([request], makeSpec({ expectedValue: 99.0 }));
    expect(result.passed).toBe(false);
    expect(result.diagnosisCode).toBe("wrong_value");
  });

  it("returns wrong_value when intercepted value is 0 but expected is non-zero", () => {
    const request = makeGA4Request({ value: 0 });
    const result = checkAssertion([request], makeSpec({ expectedValue: 49.99 }));
    expect(result.passed).toBe(false);
    expect(result.diagnosisCode).toBe("wrong_value");
  });

  it("returns ok when value matches exactly", () => {
    const request = makeGA4Request({ value: 99.0 });
    const result = checkAssertion([request], makeSpec({ expectedValue: 99.0 }));
    expect(result.passed).toBe(true);
    expect(result.diagnosisCode).toBe("ok");
  });
});

// ---------------------------------------------------------------------------
// duplicate_fire
// ---------------------------------------------------------------------------

describe("checkAssertion — duplicate_fire", () => {
  it("returns diagnosisCode=duplicate_fire when the same event fires more than once", () => {
    const requests = [
      makeGA4Request(),
      makeGA4Request({ dedupKey: "txn-002" }),
    ];
    const result = checkAssertion(requests, makeSpec());
    expect(result.passed).toBe(false);
    expect(result.diagnosisCode).toBe("duplicate_fire");
  });

  it("returns duplicate_fire for three occurrences", () => {
    const requests = [
      makeGA4Request(),
      makeGA4Request(),
      makeGA4Request(),
    ];
    const result = checkAssertion(requests, makeSpec());
    expect(result.passed).toBe(false);
    expect(result.diagnosisCode).toBe("duplicate_fire");
  });
});

// ---------------------------------------------------------------------------
// ok path
// ---------------------------------------------------------------------------

describe("checkAssertion — ok", () => {
  it("returns passed=true and diagnosisCode=ok when single matching event with correct value", () => {
    const result = checkAssertion([makeGA4Request()], makeSpec());
    expect(result.passed).toBe(true);
    expect(result.diagnosisCode).toBe("ok");
  });

  it("stores actualPayload on the result", () => {
    const payload = { tid: "G-123", v: "2" };
    const request = makeGA4Request({ payload });
    const result = checkAssertion([request], makeSpec());
    expect(result.actualPayload).toEqual(payload);
  });

  it("passes when no expectedValue and value is present", () => {
    const result = checkAssertion([makeGA4Request()], makeSpec({ expectedValue: undefined }));
    expect(result.passed).toBe(true);
    expect(result.diagnosisCode).toBe("ok");
  });
});
