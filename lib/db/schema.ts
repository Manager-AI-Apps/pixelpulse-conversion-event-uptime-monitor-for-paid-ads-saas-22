/**
 * Drizzle schema.
 *
 * The four tables below (`user`, `session`, `account`, `verification`) are the
 * Better Auth model. Better Auth validates this shape on every query and 500s
 * at runtime if any required column is missing, so they ship pre-defined and
 * correct — do NOT trim "unused" columns (the OAuth token fields on `account`,
 * `ipAddress`/`userAgent` on `session`) even for email+password-only apps.
 *
 * App-specific tables: add them BELOW the Better Auth block during the
 * schema-translation task (translate db_schema.reference.json into Drizzle
 * code here). Keep the Better Auth tables intact.
 */

import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Better Auth tables — required shape. Do not modify column names/types.
// ---------------------------------------------------------------------------

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: false }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: false }).notNull().defaultNow(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: false }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: false }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: false }).notNull().defaultNow(),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: false }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: false }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: false }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: false }).notNull().defaultNow(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: false }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: false }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: false }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// App tables — PixelPulse
// ---------------------------------------------------------------------------

// ── Enums ──────────────────────────────────────────────────────────────────

/** Status for monitors and check runs */
export const statusEnum = pgEnum("status", [
  "active",
  "paused",
  "passing",
  "failing",
  "pending",
]);

/** Browser interaction type for funnel steps */
export const actionTypeEnum = pgEnum("action_type", [
  "navigate",
  "click",
  "fill",
  "wait",
  "submit",
]);

/** Tracking platform for event assertions */
export const platformEnum = pgEnum("platform", [
  "ga4",
  "meta_browser",
  "meta_capi",
  "google_ads",
  "stripe",
]);

/** Diagnosis codes for failed check runs */
export const diagnosisCodeEnum = pgEnum("diagnosis_code", [
  "ok",
  "purchase_without_value",
  "duplicate_via_gtag_gtm",
  "capi_silent_fail",
  "ga4_property_mismatch",
  "event_not_fired",
  "value_mismatch",
  "currency_mismatch",
  "dedup_key_missing",
]);

// ── Tables ─────────────────────────────────────────────────────────────────

/**
 * A Monitor represents one recorded funnel that PixelPulse
 * checks on a schedule (e.g. every 15 min) for a given user.
 */
export const monitor = pgTable(
  "monitor",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    url: text("url").notNull(),
    status: statusEnum("status").notNull().default("active"),
    intervalMinutes: integer("interval_minutes").notNull().default(15),
    slackWebhookUrl: text("slack_webhook_url"),
    createdAt: timestamp("created_at", { withTimezone: false }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: false }).notNull().defaultNow(),
  },
  (t) => [
    index("monitor_user_id_idx").on(t.userId),
    index("monitor_status_idx").on(t.status),
  ],
);

/**
 * An ordered step in the recorded funnel (click, navigate, fill, etc.)
 */
export const funnelStep = pgTable(
  "funnel_step",
  {
    id: text("id").primaryKey(),
    monitorId: text("monitor_id")
      .notNull()
      .references(() => monitor.id, { onDelete: "cascade" }),
    /** Zero-based ordering within the funnel */
    stepOrder: integer("step_order").notNull(),
    actionType: actionTypeEnum("action_type").notNull(),
    /** Serialized selector / URL / value depending on actionType */
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at", { withTimezone: false }).notNull().defaultNow(),
  },
  (t) => [
    index("funnel_step_monitor_id_idx").on(t.monitorId),
    index("funnel_step_order_idx").on(t.monitorId, t.stepOrder),
  ],
);

/**
 * A declared expectation: after step N fires, platform P should emit event E
 * with the given properties.
 */
export const eventAssertion = pgTable(
  "event_assertion",
  {
    id: text("id").primaryKey(),
    funnelStepId: text("funnel_step_id")
      .notNull()
      .references(() => funnelStep.id, { onDelete: "cascade" }),
    platform: platformEnum("platform").notNull(),
    /** Expected event name, e.g. "Purchase", "sign_up" */
    eventName: text("event_name").notNull(),
    /** Optional expected currency (ISO 4217) */
    expectedCurrency: text("expected_currency"),
    /** Serialized expected properties (value, dedup key, etc.) */
    expectedProps: jsonb("expected_props"),
    createdAt: timestamp("created_at", { withTimezone: false }).notNull().defaultNow(),
  },
  (t) => [
    index("event_assertion_step_id_idx").on(t.funnelStepId),
    index("event_assertion_platform_idx").on(t.platform),
  ],
);

/**
 * A single scheduled synthetic run of a monitor's funnel.
 */
export const checkRun = pgTable(
  "check_run",
  {
    id: text("id").primaryKey(),
    monitorId: text("monitor_id")
      .notNull()
      .references(() => monitor.id, { onDelete: "cascade" }),
    status: statusEnum("status").notNull().default("pending"),
    startedAt: timestamp("started_at", { withTimezone: false }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: false }),
    /** Overall diagnosis for the run */
    diagnosisCode: diagnosisCodeEnum("diagnosis_code"),
    /** Human-readable alert message sent to Slack (if any) */
    alertMessage: text("alert_message"),
    createdAt: timestamp("created_at", { withTimezone: false }).notNull().defaultNow(),
  },
  (t) => [
    index("check_run_monitor_id_idx").on(t.monitorId),
    index("check_run_status_idx").on(t.status),
    index("check_run_started_at_idx").on(t.startedAt),
  ],
);

/**
 * Per-assertion outcome within a single check run.
 */
export const eventAssertionResult = pgTable(
  "event_assertion_result",
  {
    id: text("id").primaryKey(),
    checkRunId: text("check_run_id")
      .notNull()
      .references(() => checkRun.id, { onDelete: "cascade" }),
    eventAssertionId: text("event_assertion_id")
      .notNull()
      .references(() => eventAssertion.id, { onDelete: "cascade" }),
    passed: boolean("passed").notNull(),
    diagnosisCode: diagnosisCodeEnum("diagnosis_code").notNull().default("ok"),
    /** Raw captured network payload or null if nothing was captured */
    capturedPayload: jsonb("captured_payload"),
    createdAt: timestamp("created_at", { withTimezone: false }).notNull().defaultNow(),
  },
  (t) => [
    index("event_assertion_result_run_id_idx").on(t.checkRunId),
    index("event_assertion_result_assertion_id_idx").on(t.eventAssertionId),
    index("event_assertion_result_passed_idx").on(t.passed),
  ],
);
