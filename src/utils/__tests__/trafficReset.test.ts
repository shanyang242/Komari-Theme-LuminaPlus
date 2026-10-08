import { describe, expect, it } from "vitest";
import { getTrafficResetDisplay, normalizeTrafficResetDays } from "@/utils/trafficReset";

const local = (year: number, month: number, day: number, hour = 12) =>
  new Date(year, month - 1, day, hour).getTime();

describe("monthly traffic reset from expiry day", () => {
  it("uses the expiry day independently of expiry month and billing cycle", () => {
    expect(getTrafficResetDisplay(local(2026, 11, 30), local(2026, 9, 9))).toEqual({
      day: 30,
      date: "2026-09-30",
      label: "21天后重置",
      title: "流量重置日：2026-09-30 · 默认按到期日，每月30日重置（不足该日取月末）",
    });
  });

  it("keeps today visible through the entire reset day", () => {
    expect(getTrafficResetDisplay(local(2026, 11, 15), local(2026, 9, 15, 23))?.label).toBe("今日重置");
    expect(getTrafficResetDisplay(local(2026, 11, 15), local(2026, 9, 16, 0))?.label).toBe("29天后重置");
  });

  it("clamps to month end and restores the original day in the next month", () => {
    const expiry = local(2026, 12, 31);
    expect(getTrafficResetDisplay(expiry, local(2026, 2, 27))?.label).toBe("1天后重置");
    expect(getTrafficResetDisplay(expiry, local(2026, 2, 28))?.label).toBe("今日重置");
    expect(getTrafficResetDisplay(expiry, local(2026, 3, 1))?.title).toContain("2026-03-31");
    expect(getTrafficResetDisplay(expiry, local(2028, 2, 28))?.label).toBe("1天后重置");
  });

  it("rolls December into the following year", () => {
    expect(getTrafficResetDisplay(local(2026, 11, 5), local(2026, 12, 31))?.title).toContain("2027-01-05");
  });

  it("accepts ISO dates and Unix timestamps using the existing date parser", () => {
    const expiry = local(2026, 11, 30);
    const now = local(2026, 9, 9);
    const expected = getTrafficResetDisplay(expiry, now);
    expect(getTrafficResetDisplay(new Date(expiry).toISOString(), now)).toEqual(expected);
    expect(getTrafficResetDisplay(String(expiry / 1000), now)).toEqual(expected);
  });

  it("counts calendar days across daylight saving boundaries", () => {
    expect(getTrafficResetDisplay(local(2026, 11, 10), local(2026, 3, 7, 23))?.label).toBe("3天后重置");
  });

  it("hides missing, invalid and long-term sentinel dates", () => {
    const now = local(2026, 9, 9);
    for (const value of [null, undefined, "", "invalid", "0001-01-01T00:00:00Z", 0, -1, "9999-12-31T00:00:00Z"]) {
      expect(getTrafficResetDisplay(value, now)).toBeNull();
    }
    expect(getTrafficResetDisplay(local(2026, 11, 30), NaN)).toBeNull();
  });

  it("prioritizes theme overrides, including nodes without an expiry", () => {
    const now = local(2026, 9, 9);
    for (const expiry of [local(2026, 11, 30), null, "invalid", "9999-12-31T00:00:00Z"]) {
      expect(getTrafficResetDisplay(expiry, now, 15)).toEqual({
        day: 15,
        date: "2026-09-15",
        label: "6天后重置",
        title: "流量重置日：2026-09-15 · 自定义，每月15日重置（不足该日取月末）",
      });
    }
    expect(getTrafficResetDisplay(null, NaN, 15)).toBeNull();
  });

  it("falls back to expiry when an override is removed or invalid", () => {
    const expiry = local(2026, 11, 30);
    const now = local(2026, 9, 9);
    for (const day of [undefined, 0, -1, 32, 1.5, NaN, Infinity]) {
      expect(getTrafficResetDisplay(expiry, now, day)).toEqual(getTrafficResetDisplay(expiry, now));
    }
  });

  it("preserves custom days across short months, leap years and year boundaries", () => {
    expect(getTrafficResetDisplay(null, local(2026, 2, 28, 23), 31)).toMatchObject({
      day: 31, date: "2026-02-28", label: "今日重置",
    });
    expect(getTrafficResetDisplay(null, local(2026, 3, 1), 31)?.date).toBe("2026-03-31");
    expect(getTrafficResetDisplay(null, local(2028, 2, 28), 31)?.label).toBe("1天后重置");
    expect(getTrafficResetDisplay(null, local(2026, 12, 31), 1)?.date).toBe("2027-01-01");
  });
});

describe("normalizeTrafficResetDays", () => {
  it("accepts only integer days and keeps stable UUID ordering without mutating input", () => {
    const input = { z: 31, a: 1, blank: "", string: "15", zero: 0, negative: -1, fraction: 1.5, big: 32, inf: Infinity, nan: NaN, bool: true, " ": 15 };
    expect(normalizeTrafficResetDays(input)).toEqual({ a: 1, z: 31 });
    expect(Object.keys(normalizeTrafficResetDays(input))).toEqual(["a", "z"]);
    expect(input.string).toBe("15");
  });

  it("treats absent or malformed settings as no overrides", () => {
    for (const value of [undefined, null, "15", 15, [1, 15], true]) {
      expect(normalizeTrafficResetDays(value)).toEqual({});
    }
  });
});
