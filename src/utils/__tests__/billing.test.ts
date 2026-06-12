import { describe, expect, it } from "vitest";
import { formatBillingCycle } from "@/utils/billing";

describe("formatBillingCycle", () => {
  it("maps known day-counts to labels", () => {
    expect(formatBillingCycle(30)).toBe("月");
    expect(formatBillingCycle(90)).toBe("季");
    expect(formatBillingCycle(180)).toBe("半年");
    expect(formatBillingCycle(365)).toBe("年");
    expect(formatBillingCycle(360)).toBe("年");
  });

  it("renders whole-year multiples", () => {
    expect(formatBillingCycle(730)).toBe("2年");
    expect(formatBillingCycle(1095)).toBe("3年");
  });

  it("treats -1 as a lifetime cycle (regression)", () => {
    expect(formatBillingCycle(-1)).toBe("永久");
  });

  it("does not render unset cycles as 0天 (regression)", () => {
    expect(formatBillingCycle("")).toBe("年");
    expect(formatBillingCycle(null)).toBe("年");
    expect(formatBillingCycle(undefined)).toBe("年");
    expect(formatBillingCycle(0)).toBe("年");
  });

  it("maps textual cycles", () => {
    expect(formatBillingCycle("monthly")).toBe("月");
    expect(formatBillingCycle("年")).toBe("年");
    expect(formatBillingCycle("lifetime")).toBe("永久");
  });

  it("falls back to a day-count for arbitrary positive numbers", () => {
    expect(formatBillingCycle(45)).toBe("45天");
  });
});
