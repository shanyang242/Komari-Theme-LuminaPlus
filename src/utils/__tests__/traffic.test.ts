import { describe, expect, it } from "vitest";
import { computeTrafficUsed, resolveTrafficUsage, trafficTypeLabel } from "@/utils/traffic";

describe("computeTrafficUsed", () => {
  it("reduces up/down per type", () => {
    expect(computeTrafficUsed("sum", 30, 70)).toBe(100);
    expect(computeTrafficUsed("up", 30, 70)).toBe(30);
    expect(computeTrafficUsed("down", 30, 70)).toBe(70);
    expect(computeTrafficUsed("max", 30, 70)).toBe(70);
    expect(computeTrafficUsed("min", 30, 70)).toBe(30);
  });

  it("defaults to max for empty/unknown (backend gorm default)", () => {
    expect(computeTrafficUsed("", 30, 70)).toBe(70);
    expect(computeTrafficUsed(undefined, 80, 20)).toBe(80);
    expect(computeTrafficUsed(null, 80, 20)).toBe(80);
    expect(computeTrafficUsed("weird", 80, 20)).toBe(80);
  });

  it("is case- and whitespace-insensitive", () => {
    expect(computeTrafficUsed(" SUM ", 30, 70)).toBe(100);
    expect(computeTrafficUsed("Up", 30, 70)).toBe(30);
  });

  it("guards NaN/negative inputs to 0", () => {
    expect(computeTrafficUsed("sum", Number.NaN, 70)).toBe(70);
    expect(computeTrafficUsed("sum", -5, 70)).toBe(70);
    expect(computeTrafficUsed("min", -5, 70)).toBe(0);
  });
});

describe("resolveTrafficUsage", () => {
  it("derives used/remaining/fraction from a limit", () => {
    const usage = resolveTrafficUsage("sum", 30, 70, 200);
    expect(usage.used).toBe(100);
    expect(usage.limit).toBe(200);
    expect(usage.unlimited).toBe(false);
    expect(usage.remaining).toBe(100);
    expect(usage.fraction).toBe(0.5);
  });

  it("reduces by type before measuring against the limit", () => {
    expect(resolveTrafficUsage("max", 30, 70, 200).used).toBe(70);
    expect(resolveTrafficUsage("up", 30, 70, 200).used).toBe(30);
  });

  it("treats limit <= 0 as unlimited", () => {
    const usage = resolveTrafficUsage("sum", 30, 70, 0);
    expect(usage.unlimited).toBe(true);
    expect(usage.remaining).toBe(0);
    expect(usage.fraction).toBe(0);
  });

  it("clamps fraction and remaining when over the limit", () => {
    const usage = resolveTrafficUsage("sum", 150, 100, 200);
    expect(usage.used).toBe(250);
    expect(usage.fraction).toBe(1);
    expect(usage.remaining).toBe(0);
  });

  it("prefers a backend effective value, including an exact zero", () => {
    expect(resolveTrafficUsage("sum", 30, 70, 200, 40).used).toBe(40);
    const zero = resolveTrafficUsage("sum", 30, 70, 200, 0);
    expect(zero.used).toBe(0);
    expect(zero.remaining).toBe(200);
    expect(zero.fraction).toBe(0);
  });

  it("keeps the legacy calculation when the backend field is missing", () => {
    expect(resolveTrafficUsage("sum", 30, 70, 200, undefined).used).toBe(100);
    expect(resolveTrafficUsage("sum", 30, 70, 200, null).used).toBe(100);
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
