/**
 * Unit tests for the sliding-window rate limiter.
 *
 * These tests exercise `rateLimit()` entirely in-memory — no database, no mocks.
 * Each test starts from a clean slate via `clearRateLimits()`.
 */

import { describe, it, expect, beforeEach } from "vitest";

import { rateLimit, clearRateLimits } from "@/lib/rate-limit";

beforeEach(() => {
  clearRateLimits();
});

describe("rateLimit (sliding window)", () => {
  it("allows exactly `limit` requests within the window", () => {
    const key = "user-a:import";

    for (let i = 0; i < 10; i++) {
      const result = rateLimit(key, 10, 60_000);
      expect(result.limited).toBe(false);
      expect(result.remaining).toBe(9 - i);
    }
  });

  it("blocks after 10 req/min — returns {limited:true}", () => {
    const key = "user-b:import";

    // First 10 are fine
    for (let i = 0; i < 10; i++) {
      rateLimit(key, 10, 60_000);
    }

    // 11th request is over the limit
    const result = rateLimit(key, 10, 60_000);
    expect(result.limited).toBe(true);
    expect(result.remaining).toBe(0);
  });

  it("different keys are independent — exhausting one does not affect the other", () => {
    const key1 = "user-1:import";
    const key2 = "user-2:import";

    // Exhaust key1
    for (let i = 0; i < 10; i++) {
      rateLimit(key1, 10, 60_000);
    }
    expect(rateLimit(key1, 10, 60_000).limited).toBe(true);

    // key2 is unaffected
    const r2 = rateLimit(key2, 10, 60_000);
    expect(r2.limited).toBe(false);
  });

  it("sliding window admits a new request once the oldest one expires", () => {
    const key = "user-c:import";
    const now = Date.now();

    // Manually inject 9 timestamps that are 90 seconds old (expired in a 60s window)
    // We do this by calling with a tiny window to simulate expiry, or by calling
    // the public function repeatedly with fake time.
    //
    // Instead we use a 10 ms window so we can wait it out.
    const shortWindow = 50;

    // Exhaust a 2-request, 50 ms window
    rateLimit(`${key}-short`, 2, shortWindow);
    rateLimit(`${key}-short`, 2, shortWindow);
    expect(rateLimit(`${key}-short`, 2, shortWindow).limited).toBe(true);

    // After the window expires, a new request is admitted
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        const result = rateLimit(`${key}-short`, 2, shortWindow);
        expect(result.limited).toBe(false);
        resolve();
      }, shortWindow + 10);
    });
  });

  it("resetAt is a future epoch timestamp", () => {
    const key = "user-d:import";
    const before = Date.now();
    const result = rateLimit(key, 10, 60_000);
    expect(result.resetAt).toBeGreaterThan(before);
  });
});
