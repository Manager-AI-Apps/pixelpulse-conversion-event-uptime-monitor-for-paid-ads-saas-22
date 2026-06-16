/**
 * Acceptance tests for task-5-3:
 *   1. snippet page renders script tag: renders '<script', 'data-monitor-id', 'pixelpulse.config.json'
 *   2. public/snippet.js is valid JS: loads without syntax errors, no hardcoded secrets
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import SnippetPage from "@/app/snippet/page";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// ---------------------------------------------------------------------------
// 1. Snippet page renders script tag
// ---------------------------------------------------------------------------

describe("snippet page renders script tag", () => {
  it("renders '<script' text in the page", () => {
    const { container } = render(<SnippetPage />);
    expect(container.textContent).toContain("<script");
  });

  it("renders 'data-monitor-id' in the page", () => {
    const { container } = render(<SnippetPage />);
    expect(container.textContent).toContain("data-monitor-id");
  });

  it("renders 'pixelpulse.config.json' in the page", () => {
    const { container } = render(<SnippetPage />);
    expect(container.textContent).toContain("pixelpulse.config.json");
  });
});

// ---------------------------------------------------------------------------
// 2. public/snippet.js is valid JS and contains no hardcoded secrets
// ---------------------------------------------------------------------------

describe("public/snippet.js is valid JS", () => {
  const snippetPath = join(ROOT, "public", "snippet.js");

  it("public/snippet.js file exists", () => {
    expect(
      existsSync(snippetPath),
      `Expected file to exist at ${snippetPath}`,
    ).toBe(true);
  });

  it("snippet.js parses without syntax errors", () => {
    const source = readFileSync(snippetPath, "utf-8");
    // Wrapping in a function is sufficient to trigger a SyntaxError for
    // invalid JS without actually executing any side-effects.
    expect(() => new Function(source)).not.toThrow();
  });

  it("snippet.js does not contain hardcoded API keys or secrets", () => {
    const source = readFileSync(snippetPath, "utf-8");

    // Common secret token patterns
    const secretPatterns = [
      /sk-[A-Za-z0-9]{20,}/,       // OpenAI-style keys
      /rnd_[A-Za-z0-9]{20,}/,      // Render secrets
      /gh[pousr]_[A-Za-z0-9]{20,}/, // GitHub tokens
      /xox[bpoa]-[A-Za-z0-9-]{20,}/, // Slack tokens
      /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/, // JWT-like tokens
      /AKIA[0-9A-Z]{16}/,           // AWS access key IDs
    ];

    for (const pattern of secretPatterns) {
      expect(source).not.toMatch(pattern);
    }
  });
});
