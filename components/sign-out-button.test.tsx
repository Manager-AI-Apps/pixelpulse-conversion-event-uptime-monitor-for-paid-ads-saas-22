import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SignOutButton } from "@/components/sign-out-button";

// Mock auth client
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    signOut: vi.fn().mockResolvedValue({}),
  },
}));

// Mock next/navigation (router not available in jsdom)
const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => "/",
}));

import { authClient } from "@/lib/auth-client";

describe("SignOutButton", () => {
  it("renders a sign-out button", () => {
    render(<SignOutButton />);
    expect(screen.getByRole("button", { name: /sign out/i })).toBeInTheDocument();
  });

  it("calls authClient.signOut on click", () => {
    render(<SignOutButton />);
    const btn = screen.getByRole("button", { name: /sign out/i });
    fireEvent.click(btn);
    expect(authClient.signOut).toHaveBeenCalledTimes(1);
  });
});
