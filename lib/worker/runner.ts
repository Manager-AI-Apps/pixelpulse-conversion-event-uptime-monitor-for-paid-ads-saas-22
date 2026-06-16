/**
 * Funnel replay runner for the PixelPulse worker process.
 *
 * Design: The runner accepts a `PageLike` interface (dependency injection)
 * rather than importing Playwright directly. This keeps the module testable
 * without browser binaries and lets the entry-point script (`server.js` /
 * a Render worker job) create the real Playwright page and pass it in.
 *
 * Supported platforms and their detection URLs:
 *   ga4          : /g/collect (via gtag.js or GTM)
 *   meta_browser : facebook.com/tr
 *   meta_capi    : graph.facebook.com/…/events
 *   stripe       : r.stripe.com/b  (purchase radar event)
 *
 * IMPORTANT: actualPayload is stored verbatim — PII scrubbing is deferred
 * to v2. Never log payloads to stdout or expose them in API responses.
 */

import { checkStepAssertions } from "./assertions";
import type {
  AssertionSpec,
  CheckResult,
  DiagnosisCode,
  FunnelStepSpec,
  InterceptedRequest,
  Platform,
  RunnerConfig,
  RunResult,
} from "./types";

// ---------------------------------------------------------------------------
// Minimal Playwright-compatible interfaces (dependency inversion)
// ---------------------------------------------------------------------------

/**
 * Subset of Playwright's Route that we use.
 * Compatible with the real playwright.Route type.
 */
export interface RouteLike {
  continue(): Promise<void>;
  abort(errorCode?: string): Promise<void>;
}

/**
 * Subset of Playwright's Request that we use.
 * Compatible with the real playwright.Request type.
 */
export interface RequestLike {
  url(): string;
  method(): string;
  postData(): string | null;
  postDataJSON(): Record<string, unknown> | null;
}

/**
 * Subset of Playwright's Page that the runner needs.
 * Pass the real `page` object from Playwright's `browser.newPage()`; it
 * satisfies this interface automatically.
 */
export interface PageLike {
  route(
    pattern: string | RegExp,
    handler: (route: RouteLike, request: RequestLike) => Promise<void>,
  ): Promise<void>;
  goto(url: string, options?: { timeout?: number; waitUntil?: string }): Promise<unknown>;
  click(selector: string, options?: { timeout?: number }): Promise<void>;
  fill(selector: string, value: string, options?: { timeout?: number }): Promise<void>;
  waitForTimeout(ms: number): Promise<void>;
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// URL pattern → Platform detection
// ---------------------------------------------------------------------------

const PLATFORM_PATTERNS: ReadonlyArray<{ pattern: RegExp; platform: Platform }> = [
  { pattern: /google-analytics\.com\/g\/collect/i, platform: "ga4" },
  { pattern: /analytics\.google\.com\/g\/collect/i, platform: "ga4" },
  { pattern: /facebook\.com\/tr\b/i, platform: "meta_browser" },
  { pattern: /graph\.facebook\.com\/.*\/events/i, platform: "meta_capi" },
  { pattern: /r\.stripe\.com\//i, platform: "stripe" },
];

function detectPlatform(url: string): Platform | null {
  for (const { pattern, platform } of PLATFORM_PATTERNS) {
    if (pattern.test(url)) return platform;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Payload parsers (one per platform)
// ---------------------------------------------------------------------------

interface ParsedEvent {
  eventName: string;
  currency?: string;
  value?: number;
  dedupKey?: string;
  payload: Record<string, unknown>;
}

function parseGA4(url: string, postData: string | null): ParsedEvent | null {
  try {
    const searchParams = new URL(url).searchParams;
    // GA4 event name is in the `en` parameter
    const eventName = searchParams.get("en");
    if (!eventName) return null;

    // Value + currency may be in ep.value / ep.currency or ev / cu
    const value = searchParams.has("ev")
      ? parseFloat(searchParams.get("ev") ?? "")
      : undefined;
    const currency = searchParams.get("cu") ?? undefined;
    const dedupKey = searchParams.get("tid") ?? undefined; // transaction_id

    const payload: Record<string, unknown> = {};
    searchParams.forEach((v, k) => {
      payload[k] = v;
    });

    // POST body may supplement URL params
    if (postData) {
      const lines = postData.split("\n");
      for (const line of lines) {
        const kv = line.split("=");
        if (kv.length === 2) payload[kv[0]] = decodeURIComponent(kv[1] ?? "");
      }
    }

    return {
      eventName,
      value: Number.isNaN(value) ? undefined : value,
      currency,
      dedupKey,
      payload,
    };
  } catch {
    return null;
  }
}

function parseMetaBrowser(url: string): ParsedEvent | null {
  try {
    const searchParams = new URL(url).searchParams;
    const eventName = searchParams.get("ev");
    if (!eventName) return null;

    const customData = searchParams.get("cd");
    let parsed: Record<string, unknown> = {};
    if (customData) {
      try {
        parsed = JSON.parse(customData) as Record<string, unknown>;
      } catch {
        // ignore parse errors — payload is best-effort
      }
    }

    return {
      eventName,
      value: typeof parsed["value"] === "number" ? parsed["value"] : undefined,
      currency: typeof parsed["currency"] === "string" ? parsed["currency"] : undefined,
      dedupKey: searchParams.get("eid") ?? undefined,
      payload: parsed,
    };
  } catch {
    return null;
  }
}

function parseMetaCAPI(postData: string | null): ParsedEvent | null {
  if (!postData) return null;
  try {
    const body = JSON.parse(postData) as Record<string, unknown>;
    const events = Array.isArray(body["data"]) ? (body["data"] as unknown[]) : [];
    if (events.length === 0) return null;

    const first = events[0] as Record<string, unknown>;
    const eventName =
      typeof first["event_name"] === "string" ? first["event_name"] : null;
    if (!eventName) return null;

    const customData =
      typeof first["custom_data"] === "object" && first["custom_data"] !== null
        ? (first["custom_data"] as Record<string, unknown>)
        : {};

    return {
      eventName,
      value: typeof customData["value"] === "number" ? customData["value"] : undefined,
      currency:
        typeof customData["currency"] === "string" ? customData["currency"] : undefined,
      dedupKey: typeof first["event_id"] === "string" ? first["event_id"] : undefined,
      payload: first,
    };
  } catch {
    return null;
  }
}

function parseStripe(url: string, postData: string | null): ParsedEvent | null {
  try {
    // Stripe Purchase events on r.stripe.com carry a JSON blob in POST body
    const payload: Record<string, unknown> = {};
    if (postData) {
      try {
        const parsed = JSON.parse(postData);
        if (typeof parsed === "object" && parsed !== null) {
          Object.assign(payload, parsed as Record<string, unknown>);
        }
      } catch {
        // Not JSON — fall through
      }
    }

    // Also parse URL query params
    const searchParams = new URL(url).searchParams;
    searchParams.forEach((v, k) => {
      payload[k] = v;
    });

    const eventName =
      typeof payload["event"] === "string" ? payload["event"] : "purchase";
    const amount =
      typeof payload["amount"] === "number"
        ? payload["amount"]
        : typeof payload["amount"] === "string"
          ? parseFloat(payload["amount"])
          : undefined;
    const currency =
      typeof payload["currency"] === "string" ? payload["currency"] : undefined;
    const dedupKey =
      typeof payload["payment_intent"] === "string"
        ? payload["payment_intent"]
        : typeof payload["charge"] === "string"
          ? payload["charge"]
          : undefined;

    return {
      eventName,
      value: amount !== undefined && !Number.isNaN(amount) ? amount : undefined,
      currency,
      dedupKey,
      payload,
    };
  } catch {
    return null;
  }
}

function parseRequest(
  platform: Platform,
  url: string,
  request: RequestLike,
): ParsedEvent | null {
  const postData = request.postData();
  switch (platform) {
    case "ga4":
      return parseGA4(url, postData);
    case "meta_browser":
      return parseMetaBrowser(url);
    case "meta_capi":
      return parseMetaCAPI(postData);
    case "stripe":
      return parseStripe(url, postData);
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Request interceptor
// ---------------------------------------------------------------------------

/**
 * Attach a network interceptor to `page` that collects all tracking requests.
 * Returns a mutable array that grows as the page makes network calls.
 * Call this BEFORE executing any funnel steps so requests are not missed.
 */
export async function attachInterceptor(
  page: PageLike,
): Promise<InterceptedRequest[]> {
  const collected: InterceptedRequest[] = [];

  await page.route(/.+/, async (route, request) => {
    const url = request.url();
    const platform = detectPlatform(url);

    if (platform !== null) {
      const parsed = parseRequest(platform, url, request);
      if (parsed !== null) {
        collected.push({
          url,
          platform,
          eventName: parsed.eventName,
          currency: parsed.currency,
          value: parsed.value,
          dedupKey: parsed.dedupKey,
          payload: parsed.payload,
        });
      }
    }

    await route.continue();
  });

  return collected;
}

// ---------------------------------------------------------------------------
// Funnel step execution
// ---------------------------------------------------------------------------

const DEFAULT_STEP_TIMEOUT_MS = 10_000;

async function executeStep(
  page: PageLike,
  step: FunnelStepSpec,
  timeoutMs: number,
): Promise<void> {
  const payload = step.payload;

  switch (step.actionType) {
    case "navigate": {
      const url = typeof payload["url"] === "string" ? payload["url"] : "";
      await page.goto(url, { timeout: timeoutMs, waitUntil: "networkidle" });
      break;
    }
    case "click": {
      const selector =
        typeof payload["selector"] === "string" ? payload["selector"] : "";
      await page.click(selector, { timeout: timeoutMs });
      break;
    }
    case "fill": {
      const selector =
        typeof payload["selector"] === "string" ? payload["selector"] : "";
      const value = typeof payload["value"] === "string" ? payload["value"] : "";
      await page.fill(selector, value, { timeout: timeoutMs });
      break;
    }
    case "wait": {
      const ms =
        typeof payload["ms"] === "number" ? payload["ms"] : timeoutMs;
      await page.waitForTimeout(ms);
      break;
    }
    case "submit": {
      const selector =
        typeof payload["selector"] === "string" ? payload["selector"] : "form";
      await page.click(selector, { timeout: timeoutMs });
      break;
    }
    default: {
      // Exhaustive guard — step.actionType is a union so this is unreachable
      const _exhaustive: never = step.actionType;
      throw new Error(
        `Unhandled actionType: ${String(_exhaustive satisfies never)}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Aggregation helpers
// ---------------------------------------------------------------------------

function worstDiagnosisCode(results: CheckResult[]): DiagnosisCode {
  const PRIORITY: DiagnosisCode[] = [
    "duplicate_fire",
    "missing_event",
    "wrong_value",
    "wrong_currency",
    "dedup_key_missing",
    "ok",
  ];

  for (const code of PRIORITY) {
    if (results.some((r) => r.diagnosisCode === code)) return code;
  }
  return "ok";
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Replay a recorded funnel on the given Playwright page and evaluate every
 * event assertion against the intercepted network requests.
 *
 * Usage (in your worker Node process):
 * ```ts
 * import { chromium } from 'playwright';
 * const browser = await chromium.launch({ headless: true });
 * const page = await browser.newPage();
 * const result = await replayFunnel(page, config);
 * await browser.close();
 * ```
 *
 * The function does NOT close the page; the caller is responsible for
 * browser lifecycle management so sessions can be reused across monitor runs.
 */
export async function replayFunnel(
  page: PageLike,
  config: RunnerConfig,
): Promise<RunResult> {
  const stepTimeout = config.stepTimeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;
  const allResults: CheckResult[] = [];

  // Attach the network interceptor before any navigation
  const intercepted = await attachInterceptor(page);

  for (const step of config.steps) {
    // Snapshot count before step so we only evaluate new requests
    const captureStart = intercepted.length;

    try {
      await executeStep(page, step, stepTimeout);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        passed: false,
        checkResults: allResults,
        diagnosisCode: "missing_event",
        error: `Step ${step.stepOrder} (${step.actionType}) failed: ${message}`,
      };
    }

    // Evaluate assertions against requests captured during this step
    const stepRequests = intercepted.slice(captureStart);
    const specs: AssertionSpec[] = step.assertions;
    const stepResults = checkStepAssertions(stepRequests, specs);
    allResults.push(...stepResults);
  }

  const diagnosisCode = worstDiagnosisCode(allResults);
  return {
    passed: diagnosisCode === "ok",
    checkResults: allResults,
    diagnosisCode,
  };
}
