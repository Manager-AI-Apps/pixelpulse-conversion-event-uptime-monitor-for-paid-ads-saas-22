import { describe, it, expect } from "vitest";
import * as schema from "@/lib/db/schema";

describe("PixelPulse schema enums", () => {
  it("exports statusEnum with correct literals", () => {
    expect(schema.statusEnum).toBeDefined();
    const config = schema.statusEnum.enumValues;
    expect(config).toContain("active");
    expect(config).toContain("paused");
    expect(config).toContain("passing");
    expect(config).toContain("failing");
    expect(config).toContain("pending");
  });

  it("exports actionTypeEnum with correct literals", () => {
    expect(schema.actionTypeEnum).toBeDefined();
    const config = schema.actionTypeEnum.enumValues;
    expect(config).toContain("click");
    expect(config).toContain("navigate");
    expect(config).toContain("fill");
    expect(config).toContain("wait");
    expect(config).toContain("submit");
  });

  it("exports platformEnum with correct literals", () => {
    expect(schema.platformEnum).toBeDefined();
    const config = schema.platformEnum.enumValues;
    expect(config).toContain("ga4");
    expect(config).toContain("meta_browser");
    expect(config).toContain("meta_capi");
    expect(config).toContain("google_ads");
    expect(config).toContain("stripe");
  });

  it("exports diagnosisCodeEnum with correct literals", () => {
    expect(schema.diagnosisCodeEnum).toBeDefined();
    const config = schema.diagnosisCodeEnum.enumValues;
    expect(config).toContain("purchase_without_value");
    expect(config).toContain("duplicate_via_gtag_gtm");
    expect(config).toContain("capi_silent_fail");
    expect(config).toContain("ga4_property_mismatch");
    expect(config).toContain("ok");
  });
});

describe("PixelPulse schema tables", () => {
  it("exports monitor table", () => {
    expect(schema.monitor).toBeDefined();
    const cols = Object.keys(schema.monitor);
    expect(cols).not.toHaveLength(0);
  });

  it("exports funnel_step table", () => {
    expect(schema.funnelStep).toBeDefined();
  });

  it("exports event_assertion table", () => {
    expect(schema.eventAssertion).toBeDefined();
  });

  it("exports check_run table", () => {
    expect(schema.checkRun).toBeDefined();
  });

  it("exports event_assertion_result table", () => {
    expect(schema.eventAssertionResult).toBeDefined();
  });

  it("Better Auth tables still present", () => {
    expect(schema.user).toBeDefined();
    expect(schema.session).toBeDefined();
    expect(schema.account).toBeDefined();
    expect(schema.verification).toBeDefined();
  });
});
