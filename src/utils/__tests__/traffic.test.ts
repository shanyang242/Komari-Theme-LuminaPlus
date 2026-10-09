import { describe, expect, it } from "vitest";
import { resolveTrafficUsage, trafficTypeLabel } from "@/utils/traffic";

describe("resolveTrafficUsage", () => {
  it("derives used/remaining/fraction from a limit", () => {
    const usage = resolveTrafficUsage(200, 100);
    expect(usage.used).toBe(100);
    expect(usage.limit).toBe(200);
    expect(usage.unlimited).toBe(false);
    expect(usage.remaining).toBe(100);
    expect(usage.fraction).toBe(0.5);
  });

  it("treats limit <= 0 as unlimited", () => {
    const usage = resolveTrafficUsage(0, 100);
    expect(usage.unlimited).toBe(true);
    expect(usage.remaining).toBe(0);
    expect(usage.fraction).toBe(0);
  });

  it("clamps fraction and remaining when over the limit", () => {
    const usage = resolveTrafficUsage(200, 250);
    expect(usage.used).toBe(250);
    expect(usage.fraction).toBe(1);
    expect(usage.remaining).toBe(0);
  });

  it("accepts an exact zero from the backend", () => {
    expect(resolveTrafficUsage(200, 40).used).toBe(40);
    const zero = resolveTrafficUsage(200, 0);
    expect(zero.used).toBe(0);
    expect(zero.remaining).toBe(200);
    expect(zero.fraction).toBe(0);
  });
});

describe("trafficTypeLabel", () => {
  it("labels each known type", () => {
    expect(trafficTypeLabel("up")).toBe("仅上行");
    expect(trafficTypeLabel("down")).toBe("仅下行");
    expect(trafficTypeLabel("sum")).toBe("上行+下行");
    expect(trafficTypeLabel("min")).toBe("上下取小");
    expect(trafficTypeLabel("max")).toBe("上下取大");
  });

  it("falls back to max label for empty/unknown", () => {
    expect(trafficTypeLabel("")).toBe("上下取大");
    expect(trafficTypeLabel(undefined)).toBe("上下取大");
  });
});
