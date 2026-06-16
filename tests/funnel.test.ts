/**
 * Integration tests for funnel step + event assertion query functions.
 *
 * These tests run against an in-process Postgres (pglite) with the full schema
 * applied — no Docker, no DATABASE_URL.
 */

import { beforeEach, afterEach, describe, it, expect } from "vitest";
import { ZodError } from "zod";

import { createTestDb } from "@/tests/helpers/test-db";
import type { Database } from "@/lib/db";
import { createMonitor } from "@/lib/queries/monitors";
import {
  addFunnelStep,
  addEventAssertion,
  AuthorizationError,
} from "@/lib/queries/funnel";
import { user } from "@/lib/db/schema";

let testDb: Awaited<ReturnType<typeof createTestDb>>;

beforeEach(async () => {
  testDb = await createTestDb();
});

afterEach(async () => {
  await testDb.close();
});

async function seedUser(db: Database, id: string, email: string) {
  await db.insert(user).values({ id, name: "Test User", email });
}

// ---------------------------------------------------------------------------
// addFunnelStep
// ---------------------------------------------------------------------------

describe("addFunnelStep", () => {
  it("persists with correct stepOrder", async () => {
    const db = testDb.db;
    await seedUser(db, "user-a", "a@example.com");
    const mon = await createMonitor(db, {
      userId: "user-a",
      name: "Checkout Funnel",
      url: "https://example.com/checkout",
    });

    const step0 = await addFunnelStep(db, {
      monitorId: mon.id,
      actionType: "navigate",
      payload: { url: "https://example.com/checkout" },
    });

    expect(step0.monitorId).toBe(mon.id);
    expect(step0.actionType).toBe("navigate");
    expect(step0.stepOrder).toBe(0);

    // Second step gets stepOrder 1
    const step1 = await addFunnelStep(db, {
      monitorId: mon.id,
      actionType: "click",
      payload: { selector: "#buy-now" },
    });

    expect(step1.stepOrder).toBe(1);
  });

  it("invalid actionType throws ZodError", async () => {
    const db = testDb.db;
    await seedUser(db, "user-a", "a@example.com");
    const mon = await createMonitor(db, {
      userId: "user-a",
      name: "Checkout Funnel",
      url: "https://example.com/checkout",
    });

    await expect(
      addFunnelStep(db, {
        monitorId: mon.id,
        // @ts-expect-error intentionally invalid
        actionType: "hover",
        payload: { selector: "#btn" },
      }),
    ).rejects.toBeInstanceOf(ZodError);
  });
});

// ---------------------------------------------------------------------------
// addEventAssertion
// ---------------------------------------------------------------------------

describe("addEventAssertion", () => {
  it("inserts assertion when userId owns the monitor", async () => {
    const db = testDb.db;
    await seedUser(db, "user-a", "a@example.com");
    const mon = await createMonitor(db, {
      userId: "user-a",
      name: "Checkout Funnel",
      url: "https://example.com/checkout",
    });
    const step = await addFunnelStep(db, {
      monitorId: mon.id,
      actionType: "submit",
      payload: { selector: "#checkout-form" },
    });

    const assertion = await addEventAssertion(db, "user-a", {
      funnelStepId: step.id,
      platform: "ga4",
      eventName: "purchase",
      expectedCurrency: "USD",
      expectedProps: { value: 99.99 },
    });

    expect(assertion.funnelStepId).toBe(step.id);
    expect(assertion.platform).toBe("ga4");
    expect(assertion.eventName).toBe("purchase");
    expect(assertion.expectedCurrency).toBe("USD");
  });

  it("enforces monitor ownership — wrong userId throws AuthorizationError", async () => {
    const db = testDb.db;
    await seedUser(db, "user-a", "a@example.com");
    await seedUser(db, "user-b", "b@example.com");
    const mon = await createMonitor(db, {
      userId: "user-a",
      name: "Checkout Funnel",
      url: "https://example.com/checkout",
    });
    const step = await addFunnelStep(db, {
      monitorId: mon.id,
      actionType: "navigate",
      payload: { url: "https://example.com/start" },
    });

    // user-b does NOT own the monitor that contains step
    await expect(
      addEventAssertion(db, "user-b", {
        funnelStepId: step.id,
        platform: "meta_browser",
        eventName: "Purchase",
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});
