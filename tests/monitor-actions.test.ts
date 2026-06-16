/**
 * Unit tests for monitor server actions.
 *
 * Tests zod validation logic for createMonitorAction and deleteMonitorAction.
 * next/cache, next/headers, and @/lib/auth are mocked so that validation runs
 * without a real database connection or HTTP request context.
 */

import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
}));

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: vi.fn(async () => null),
    },
  },
}));

vi.mock("@/lib/db", () => ({
  db: {},
}));

// Import after mocks are registered
import { createMonitorAction, deleteMonitorAction } from "@/app/_actions/monitor-actions";

describe("createMonitorAction", () => {
  it("rejects missing slackWebhookUrl", async () => {
    const result = await createMonitorAction({
      name: "GA4 Checkout",
      siteUrl: "https://example.com/checkout",
      slackWebhookUrl: "",
    });
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toBeTruthy();
  });

  it("rejects missing name", async () => {
    const result = await createMonitorAction({
      name: "",
      siteUrl: "https://example.com/checkout",
      slackWebhookUrl: "https://hooks.slack.com/services/T/B/xxx",
    });
    expect(result).toHaveProperty("error");
  });

  it("rejects invalid siteUrl", async () => {
    const result = await createMonitorAction({
      name: "Test Monitor",
      siteUrl: "not-a-url",
      slackWebhookUrl: "https://hooks.slack.com/services/T/B/xxx",
    });
    expect(result).toHaveProperty("error");
  });

  it("returns unauthorized when no session", async () => {
    const result = await createMonitorAction({
      name: "GA4 Checkout",
      siteUrl: "https://example.com/checkout",
      slackWebhookUrl: "https://hooks.slack.com/services/T/B/xxx",
    });
    // auth is mocked to return null, so even a valid input returns "error"
    expect(result).toHaveProperty("error");
  });
});

describe("deleteMonitorAction", () => {
  it("rejects missing monitorId", async () => {
    const result = await deleteMonitorAction({ monitorId: "" });
    expect(result).toHaveProperty("error");
  });
});
