/**
 * Tests for the monitor detail dashboard additions:
 *   - UptimeStats component (unit)
 *   - getMonitor authorization (integration)
 */

import { beforeEach, afterEach, describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { createTestDb } from "@/tests/helpers/test-db";
import { createMonitor, getMonitor } from "@/lib/queries/monitors";
import { user } from "@/lib/db/schema";
import { UptimeStats } from "@/app/_components/uptime-stats";
import type { UptimeStat } from "@/lib/queries/uptime";

// ---------------------------------------------------------------------------
// Integration: getMonitor authorization
// ---------------------------------------------------------------------------

let testDb: Awaited<ReturnType<typeof createTestDb>>;

beforeEach(async () => {
  testDb = await createTestDb();
});

afterEach(async () => {
  await testDb.close();
});

describe("unauthorized access redirects", () => {
  it("getMonitor with wrong userId returns null (page redirects to /dashboard)", async () => {
    const db = testDb.db;

    // Seed user-a
    await db.insert(user).values({ id: "user-a", name: "Alice", email: "alice@example.com" });

    // Create monitor owned by user-a
    const mon = await createMonitor(db, {
      userId: "user-a",
      name: "GA4 Checkout",
      url: "https://example.com",
    });

    // user-b tries to access user-a's monitor
    const result = await getMonitor(db, mon.id, "user-b");

    // Should return null — the page handles this as redirect("/dashboard")
    expect(result).toBeNull();
  });

  it("getMonitor returns the row when userId matches", async () => {
    const db = testDb.db;

    await db.insert(user).values({ id: "user-a", name: "Alice", email: "alice@example.com" });

    const mon = await createMonitor(db, {
      userId: "user-a",
      name: "Meta Pixel Signup",
      url: "https://example.com/signup",
    });

    const result = await getMonitor(db, mon.id, "user-a");
    expect(result).not.toBeNull();
    expect(result?.id).toBe(mon.id);
  });
});

// ---------------------------------------------------------------------------
// Unit: UptimeStats renders with data
// ---------------------------------------------------------------------------

const HIGH_UPTIME_STATS: UptimeStat[] = [
  {
    assertionId: "assertion-1",
    eventName: "Purchase",
    platform: "ga4",
    uptimePct: 100,
    lastDiagnosis: "ok",
  },
];

const MIXED_STATS: UptimeStat[] = [
  {
    assertionId: "assertion-1",
    eventName: "Purchase",
    platform: "ga4",
    uptimePct: 100,
    lastDiagnosis: "ok",
  },
  {
    assertionId: "assertion-2",
    eventName: "CompleteRegistration",
    platform: "meta_browser",
    uptimePct: 80,
    lastDiagnosis: "event_not_fired",
  },
];

describe("uptime stats render with data", () => {
  it("renders 100% uptime when all assertions pass", () => {
    render(
      <UptimeStats
        stats7d={HIGH_UPTIME_STATS}
        stats30d={HIGH_UPTIME_STATS}
      />,
    );

    // Should render 100% for both the 7d and 30d StatCards
    const hundredPcts = screen.getAllByText("100%");
    expect(hundredPcts.length).toBeGreaterThanOrEqual(1);
  });

  it("renders the ad-spend-at-risk callout", () => {
    render(
      <UptimeStats
        stats7d={HIGH_UPTIME_STATS}
        stats30d={HIGH_UPTIME_STATS}
      />,
    );

    // Must contain the static ad-spend callout — check specifically for the
    // "Ad-spend at risk" heading to avoid matching multiple elements.
    expect(screen.getByText("Ad-spend at risk")).toBeInTheDocument();
    // The body paragraph should also mention the industry benchmark range.
    expect(screen.getByText(/25.{0,5}30%/i)).toBeInTheDocument();
  });

  it("renders 0% uptime when no stats (no assertions run yet)", () => {
    render(<UptimeStats stats7d={[]} stats30d={[]} />);

    // Both cards should show 0% when there are no results
    const zeroPcts = screen.getAllByText("0%");
    expect(zeroPcts.length).toBeGreaterThanOrEqual(1);
  });

  it("shows last failure diagnosis badge when a failing assertion exists", () => {
    render(
      <UptimeStats
        stats7d={MIXED_STATS}
        stats30d={MIXED_STATS}
      />,
    );

    // The last diagnosis from the failing stat should appear in some form
    expect(screen.getByText(/event.not.fired|event_not_fired/i)).toBeInTheDocument();
  });
});
