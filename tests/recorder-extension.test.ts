/**
 * Unit tests for the PixelPulse Chrome recorder extension.
 *
 * Test 1: manifest.json is valid MV3 — manifest_version:3, activeTab, scripting
 * Test 2: exported JSON matches funnel_step schema — actionType, selector, value, url
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

import {
  isFunnelStep,
  buildExportData,
  VALID_ACTION_TYPES,
  type FunnelStep,
  type ActionType,
} from "../packages/recorder-extension/schema";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXT_DIR = join(__dirname, "../packages/recorder-extension");

// ---------------------------------------------------------------------------
// manifest.json — valid MV3
// ---------------------------------------------------------------------------

describe("manifest.json is valid MV3", () => {
  let manifest: Record<string, unknown>;

  it("parses as valid JSON", () => {
    const raw = readFileSync(join(EXT_DIR, "manifest.json"), "utf-8");
    manifest = JSON.parse(raw) as Record<string, unknown>;
    expect(manifest).toBeTruthy();
  });

  it("has manifest_version 3", () => {
    const raw = readFileSync(join(EXT_DIR, "manifest.json"), "utf-8");
    const m = JSON.parse(raw) as Record<string, unknown>;
    expect(m.manifest_version).toBe(3);
  });

  it("includes 'activeTab' permission", () => {
    const raw = readFileSync(join(EXT_DIR, "manifest.json"), "utf-8");
    const m = JSON.parse(raw) as Record<string, unknown>;
    const perms = m.permissions as string[];
    expect(Array.isArray(perms)).toBe(true);
    expect(perms).toContain("activeTab");
  });

  it("includes 'scripting' permission", () => {
    const raw = readFileSync(join(EXT_DIR, "manifest.json"), "utf-8");
    const m = JSON.parse(raw) as Record<string, unknown>;
    const perms = m.permissions as string[];
    expect(Array.isArray(perms)).toBe(true);
    expect(perms).toContain("scripting");
  });
});

// ---------------------------------------------------------------------------
// exported JSON matches funnel_step schema
// ---------------------------------------------------------------------------

describe("exported JSON matches funnel_step schema", () => {
  it("VALID_ACTION_TYPES contains the four required actions", () => {
    const required: ActionType[] = ["click", "fill", "navigate", "wait"];
    for (const action of required) {
      expect(VALID_ACTION_TYPES).toContain(action);
    }
  });

  it("isFunnelStep returns true for a valid step", () => {
    const step: FunnelStep = {
      actionType: "click",
      selector: "#buy-now",
      value: "",
      url: "https://example.com/checkout",
    };
    expect(isFunnelStep(step)).toBe(true);
  });

  it("isFunnelStep returns true for all valid actionTypes", () => {
    const actions: ActionType[] = ["click", "fill", "navigate", "wait"];
    for (const actionType of actions) {
      expect(
        isFunnelStep({ actionType, selector: "body", value: "", url: "https://x.com" }),
      ).toBe(true);
    }
  });

  it("isFunnelStep returns false for invalid actionType", () => {
    expect(
      isFunnelStep({ actionType: "hover", selector: "body", value: "", url: "https://x.com" }),
    ).toBe(false);
  });

  it("isFunnelStep returns false when selector is missing", () => {
    expect(
      isFunnelStep({ actionType: "click", value: "", url: "https://x.com" }),
    ).toBe(false);
  });

  it("buildExportData returns array of FunnelStep with all required fields", () => {
    const steps: FunnelStep[] = [
      { actionType: "navigate", selector: "", value: "", url: "https://example.com/signup" },
      { actionType: "fill", selector: "#email", value: "user@test.com", url: "https://example.com/signup" },
      { actionType: "click", selector: "#submit", value: "", url: "https://example.com/signup" },
      { actionType: "wait", selector: ".success", value: "2000", url: "https://example.com/dashboard" },
    ];

    const exported = buildExportData(steps);
    const json = JSON.stringify(exported);
    const parsed = JSON.parse(json) as unknown[];

    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(4);

    for (const item of parsed) {
      expect(isFunnelStep(item)).toBe(true);
      const step = item as FunnelStep;
      expect(typeof step.actionType).toBe("string");
      expect(typeof step.selector).toBe("string");
      expect(typeof step.value).toBe("string");
      expect(typeof step.url).toBe("string");
    }
  });

  it("exported JSON items have actionType from the allowed set", () => {
    const steps: FunnelStep[] = [
      { actionType: "click", selector: "#btn", value: "", url: "https://example.com" },
      { actionType: "fill", selector: "#input", value: "hello", url: "https://example.com" },
      { actionType: "navigate", selector: "", value: "", url: "https://example.com/next" },
      { actionType: "wait", selector: "", value: "1000", url: "https://example.com/next" },
    ];

    const exported = buildExportData(steps);
    for (const step of exported) {
      expect(VALID_ACTION_TYPES).toContain(step.actionType);
    }
  });
});
