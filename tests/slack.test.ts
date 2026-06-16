/**
 * Unit tests for lib/worker/slack.ts
 *
 * Acceptance tests:
 * 1. slack message contains diagnosis copy:
 *    buildSlackMessage({diagnosisCode:'capi_silent'}) returns block with 'CAPI silent fail'
 * 2. slack retries on 5xx:
 *    sendSlackAlert retries up to 3 times when webhook returns 500
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { buildSlackMessage, sendSlackAlert } from "@/lib/worker/slack";

// ---------------------------------------------------------------------------
// Acceptance test 1: slack message contains diagnosis copy
// ---------------------------------------------------------------------------

describe("slack message contains diagnosis copy", () => {
  it("buildSlackMessage({diagnosisCode:'capi_silent'}) returns block with 'CAPI silent fail'", () => {
    const payload = buildSlackMessage({ diagnosisCode: "capi_silent" });
    const serialized = JSON.stringify(payload);
    expect(serialized).toContain("CAPI silent fail");
  });

  it("maps all spec diagnosis codes to correct human-readable copy", () => {
    const cases: Array<[string, string]> = [
      ["purchase_without_value", "Purchase fired without value"],
      ["duplicate_via_gtag_gtm", "duplicate via gtag + GTM"],
      ["capi_silent_fail", "CAPI silent fail"],
      ["ga4_property_mismatch", "GA4 property mismatch"],
      ["event_not_fired", "Event missing entirely"],
    ];
    for (const [code, expected] of cases) {
      const payload = buildSlackMessage({ diagnosisCode: code });
      const serialized = JSON.stringify(payload);
      expect(serialized, `code=${code}`).toContain(expected);
    }
  });

  it("does not include actualPayload in the Slack message", () => {
    const payload = buildSlackMessage({
      diagnosisCode: "capi_silent",
      message: "Pixel check failed",
    });
    const serialized = JSON.stringify(payload);
    // No raw payload object dumped into the message
    expect(serialized).not.toContain("actualPayload");
  });
});

// ---------------------------------------------------------------------------
// Acceptance test 2: slack retries on 5xx
// ---------------------------------------------------------------------------

describe("slack retries on 5xx", () => {
  beforeEach(() => {
    process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/test-fallback";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete process.env.SLACK_WEBHOOK_URL;
  });

  it("retries up to 3 times when webhook returns 500 (4 total attempts)", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });
    vi.stubGlobal("fetch", mockFetch);

    await expect(
      sendSlackAlert({
        webhookUrl: "https://hooks.slack.com/test",
        diagnosisCode: "capi_silent",
        monitorId: "monitor-abc",
        message: "Test failure",
      }),
    ).rejects.toThrow();

    // 1 initial attempt + 3 retries = 4 total calls
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it("succeeds on a 2xx response without retrying", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
    });
    vi.stubGlobal("fetch", mockFetch);

    await sendSlackAlert({
      webhookUrl: "https://hooks.slack.com/test",
      diagnosisCode: "ga4_property_mismatch",
      monitorId: "monitor-xyz",
      message: "GA4 mismatch detected",
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("falls back to SLACK_WEBHOOK_URL env var when no webhookUrl provided", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
    });
    vi.stubGlobal("fetch", mockFetch);

    await sendSlackAlert({
      diagnosisCode: "event_not_fired",
      monitorId: "monitor-env",
      message: "Event missing entirely",
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [calledUrl] = mockFetch.mock.calls[0] as [string, ...unknown[]];
    expect(calledUrl).toBe("https://hooks.slack.com/test-fallback");
  });

  it("does not retry on 4xx responses", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: "Bad Request",
    });
    vi.stubGlobal("fetch", mockFetch);

    await expect(
      sendSlackAlert({
        webhookUrl: "https://hooks.slack.com/test",
        diagnosisCode: "capi_silent",
        monitorId: "monitor-abc",
        message: "Test failure",
      }),
    ).rejects.toThrow();

    // Should NOT retry on 4xx
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
