/**
 * Sliding-window in-memory rate limiter.
 *
 * Tracks individual request timestamps per key so the window slides
 * continuously instead of resetting at a fixed boundary. Suitable for the
 * single-instance Render free tier; swap the store for Redis/Upstash if the
 * app ever scales horizontally. Apply on auth routes (brute-force protection)
 * and specific API endpoints (abuse protection).
 *
 * Usage (in a route handler):
 *   const result = rateLimit(`import:${userId}`, 10, 60_000);
 *   if (result.limited) throw new ApiError("rate_limited", "Too many requests.");
 */

// Map key → array of request timestamps (milliseconds since epoch).
const windows = new Map<string, number[]>();

export interface RateLimitResult {
  /** true when the request is over the limit and should be blocked */
  limited: boolean;
  /** How many requests remain before the limit is hit */
  remaining: number;
  /** Epoch ms when the earliest queued request exits the window */
  resetAt: number;
}

/**
 * Sliding-window rate limiter.
 *
 * @param key      Uniquely identifies the rate-limit bucket (e.g. `import:${userId}`)
 * @param limit    Maximum number of requests permitted in `windowMs`
 * @param windowMs Duration of the sliding window in milliseconds
 */
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  const cutoff = now - windowMs;

  // Retrieve existing timestamps and discard those outside the window.
  const raw = windows.get(key) ?? [];
  const active = raw.filter((t) => t > cutoff);

  if (active.length >= limit) {
    // The oldest active request tells us when the first slot opens up.
    const oldest = Math.min(...active);
    windows.set(key, active);
    return { limited: true, remaining: 0, resetAt: oldest + windowMs };
  }

  // Admit the request by recording its timestamp.
  active.push(now);
  windows.set(key, active);

  return {
    limited: false,
    remaining: limit - active.length,
    resetAt: now + windowMs,
  };
}

/** Clear all rate-limit state. Intended for use in tests between test cases. */
export function clearRateLimits(): void {
  windows.clear();
}

/** Drop entries with no active timestamps to keep the Map bounded. */
export function pruneRateLimits(now: number = Date.now()): void {
  for (const [key, timestamps] of windows) {
    if (timestamps.every((t) => t <= now)) {
      windows.delete(key);
    }
  }
}
