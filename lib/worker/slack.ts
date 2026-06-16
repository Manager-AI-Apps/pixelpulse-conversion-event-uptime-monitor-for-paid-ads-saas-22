/**
 * Slack webhook integration for PixelPulse alerts.
 *
 * Exports two public functions:
 *   buildSlackMessage  — constructs a typed Slack Block Kit payload from a
 *                        diagnosisCode without including any raw event payload.
 *   sendSlackAlert     — POSTs the payload to a Slack incoming-webhook URL
 *                        with up to 3 retries on 5xx responses.
 *
 * The webhookUrl defaults to the SLACK_WEBHOOK_URL environment variable,
 * accessed via `requireEnv` for a fail-fast missing-var error.
 *
 * NOTE: actualPayload (raw network captures) is intentionally never included
 *       in any Slack message — do not change this.
 */

import { requireEnv } from "@/lib/env";

// ---------------------------------------------------------------------------
// Slack Block Kit types
// ---------------------------------------------------------------------------

export interface SlackTextObject {
  type: "mrkdwn" | "plain_text";
  text: string;
}

export interface SlackSectionBlock {
  type: "section";
  text: SlackTextObject;
}

export interface SlackDividerBlock {
  type: "divider";
}

export type SlackBlock = SlackSectionBlock | SlackDividerBlock;

export interface SlackPayload {
  /** Plain-text fallback shown in notifications and channel previews */
  text: string;
  /** Rich block content displayed in Slack */
  blocks: SlackBlock[];
}

// ---------------------------------------------------------------------------
// Diagnosis copy
// ---------------------------------------------------------------------------

/**
 * Maps every diagnosisCode variant (DB enum + worker shorthands + abbreviated
 * forms) to a human-readable Slack alert title.
 *
 * Keys:
 *  - DB enum values  (e.g. "capi_silent_fail")
 *  - Worker types    (e.g. "missing_event", "duplicate_fire")
 *  - Abbreviated     (e.g. "capi_silent" — used in tests and external callers)
 */
const DIAGNOSIS_COPY: Record<string, string> = {
  // ── DB enum values ────────────────────────────────────────────────────────
  purchase_without_value: "Purchase fired without value",
  duplicate_via_gtag_gtm: "duplicate via gtag + GTM",
  capi_silent_fail: "CAPI silent fail",
  ga4_property_mismatch: "GA4 property mismatch",
  event_not_fired: "Event missing entirely",
  value_mismatch: "Purchase fired without value",
  currency_mismatch: "Purchase fired without value",
  dedup_key_missing: "duplicate via gtag + GTM",
  ok: "All checks passed",
  // ── Worker DiagnosisCode shorthands ───────────────────────────────────────
  missing_event: "Event missing entirely",
  wrong_value: "Purchase fired without value",
  wrong_currency: "Purchase fired without value",
  duplicate_fire: "duplicate via gtag + GTM",
  // ── Abbreviated forms (external callers / tests) ──────────────────────────
  capi_silent: "CAPI silent fail",
  ga4_mismatch: "GA4 property mismatch",
  dup_gtag: "duplicate via gtag + GTM",
};

// ---------------------------------------------------------------------------
// buildSlackMessage
// ---------------------------------------------------------------------------

/**
 * Constructs a Slack Block Kit payload for a failed monitor check.
 *
 * NEVER includes actualPayload or any raw captured event data.
 *
 * @param params.diagnosisCode  - DB enum value, worker shorthand, or
 *                                abbreviated form (see DIAGNOSIS_COPY map).
 * @param params.monitorId      - Optional monitor ID for context.
 * @param params.message        - Optional additional detail text.
 */
export function buildSlackMessage(params: {
  diagnosisCode: string;
  monitorId?: string;
  message?: string;
}): SlackPayload {
  const { diagnosisCode, monitorId, message } = params;

  const diagnosisCopy = DIAGNOSIS_COPY[diagnosisCode] ?? diagnosisCode;
  const fallbackText = `PixelPulse alert: ${diagnosisCopy}`;

  const blocks: SlackBlock[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*🚨 PixelPulse Alert*\n*Diagnosis:* ${diagnosisCopy}`,
      },
    },
  ];

  if (monitorId) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Monitor ID:* \`${monitorId}\``,
      },
    });
  }

  if (message) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: message,
      },
    });
  }

  return { text: fallbackText, blocks };
}

// ---------------------------------------------------------------------------
// sendSlackAlert
// ---------------------------------------------------------------------------

/** Maximum number of retry attempts after an initial 5xx failure. */
const MAX_RETRIES = 3;

/**
 * POSTs a formatted Slack alert to the given webhook URL, retrying up to
 * MAX_RETRIES times on 5xx responses (e.g. transient Slack server errors).
 *
 * 4xx responses are not retried (they indicate a configuration problem).
 *
 * @param params.webhookUrl   - Slack incoming webhook URL. Falls back to the
 *                              SLACK_WEBHOOK_URL environment variable via
 *                              `requireEnv` when omitted.
 * @param params.diagnosisCode - Diagnosis code to translate into alert copy.
 * @param params.monitorId    - Monitor ID included in the alert for context.
 * @param params.message      - Additional detail text for the alert.
 *
 * @throws Error if the webhook returns a non-5xx error, or after all retry
 *         attempts are exhausted on 5xx.
 */
export async function sendSlackAlert(params: {
  webhookUrl?: string;
  diagnosisCode: string;
  monitorId: string;
  message: string;
}): Promise<void> {
  const { diagnosisCode, monitorId, message } = params;
  const webhookUrl = params.webhookUrl ?? requireEnv("SLACK_WEBHOOK_URL");

  const payload = buildSlackMessage({ diagnosisCode, monitorId, message });
  const body = JSON.stringify(payload);
  const headers = { "Content-Type": "application/json" };

  let lastError: Error | undefined;

  // 1 initial attempt + MAX_RETRIES retries = MAX_RETRIES + 1 total attempts
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers,
      body,
    });

    if (response.ok) {
      return;
    }

    if (response.status >= 500 && response.status < 600) {
      lastError = new Error(
        `Slack webhook returned HTTP ${response.status} ` +
          `(attempt ${attempt + 1} of ${MAX_RETRIES + 1})`,
      );
      // No artificial delay — the caller manages back-off if needed
      continue;
    }

    // Non-retriable error (4xx, 3xx, etc.)
    throw new Error(
      `Slack webhook returned unretriable HTTP ${response.status}: ${response.statusText}`,
    );
  }

  throw (
    lastError ??
    new Error(
      `Slack webhook failed after ${MAX_RETRIES + 1} attempts with no error captured`,
    )
  );
}
