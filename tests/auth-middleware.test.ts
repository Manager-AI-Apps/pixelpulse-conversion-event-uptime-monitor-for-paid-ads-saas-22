import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Mock better-auth/cookies before importing middleware
vi.mock("better-auth/cookies", () => ({
  getSessionCookie: vi.fn(),
}));

import { getSessionCookie } from "better-auth/cookies";
import { middleware } from "@/middleware";

const mockGetSessionCookie = vi.mocked(getSessionCookie);

describe("auth middleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects unauthenticated user from /dashboard to /sign-in", () => {
    mockGetSessionCookie.mockReturnValue(null);
    const req = new NextRequest("http://localhost:3000/dashboard");
    const res = middleware(req);
    expect(res.status).toBe(307);
    const location = res.headers.get("location");
    expect(location).toMatch(/\/sign-in/);
  });

  it("redirects unauthenticated user from /monitors/foo to /sign-in", () => {
    mockGetSessionCookie.mockReturnValue(null);
    const req = new NextRequest("http://localhost:3000/monitors/foo");
    const res = middleware(req);
    expect(res.status).toBe(307);
    const location = res.headers.get("location");
    expect(location).toMatch(/\/sign-in/);
  });

  it("allows authenticated user to access /dashboard", () => {
    // Simulate session cookie presence (any truthy value)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockGetSessionCookie.mockReturnValue("session-token" as any);
    const req = new NextRequest("http://localhost:3000/dashboard");
    const res = middleware(req);
    expect(res.status).not.toBe(307);
  });
});
