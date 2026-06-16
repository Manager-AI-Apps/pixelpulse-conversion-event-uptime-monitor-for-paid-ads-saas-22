/**
 * Unit tests for the MonitorList component.
 *
 * Tests that monitor name and siteUrl (url column) are rendered correctly.
 */

import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";

import { MonitorList } from "@/app/_components/monitor-list";

const MOCK_MONITORS = [
  {
    id: "monitor-1",
    name: "GA4 Checkout",
    url: "https://example.com/checkout",
    status: "active" as const,
    intervalMinutes: 15,
    slackWebhookUrl: "https://hooks.slack.com/services/T/B/xxx",
    userId: "user-1",
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
  },
  {
    id: "monitor-2",
    name: "Meta Pixel Signup",
    url: "https://example.com/signup",
    status: "passing" as const,
    intervalMinutes: 15,
    slackWebhookUrl: null,
    userId: "user-1",
    createdAt: new Date("2024-01-02"),
    updatedAt: new Date("2024-01-02"),
  },
];

describe("MonitorList", () => {
  it("renders monitor name and siteUrl", () => {
    render(<MonitorList monitors={MOCK_MONITORS} />);

    expect(screen.getByText("GA4 Checkout")).toBeInTheDocument();
    expect(screen.getByText("https://example.com/checkout")).toBeInTheDocument();

    expect(screen.getByText("Meta Pixel Signup")).toBeInTheDocument();
    expect(screen.getByText("https://example.com/signup")).toBeInTheDocument();
  });

  it("renders empty state when no monitors", () => {
    render(<MonitorList monitors={[]} />);
    // EmptyState renders when no rows
    expect(screen.getByText(/nothing here yet|no monitors|set up/i)).toBeInTheDocument();
  });
});
