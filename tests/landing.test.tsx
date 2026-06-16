import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Home from "@/app/page";

describe("landing page", () => {
  it("landing renders product name", () => {
    render(<Home />);
    const pixelPulseEls = screen.getAllByText(/PixelPulse/i);
    expect(pixelPulseEls.length).toBeGreaterThan(0);
    const conversionEls = screen.getAllByText(/conversion event/i);
    expect(conversionEls.length).toBeGreaterThan(0);
  });

  it("CTA links to sign-up", () => {
    const { container } = render(<Home />);
    const links = container.querySelectorAll("a[href='/sign-up']");
    expect(links.length).toBeGreaterThan(0);
  });
});
