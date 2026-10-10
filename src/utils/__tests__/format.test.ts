import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatBytes,
  formatByteRate,
  formatByteRateLabel,
  formatClockTime,
  formatExpireDays,
  formatTrafficRateLabel,
  formatUptimeDays,
  getExpireDaysRemaining,
  joinDisplayParts,
  parseTags,
  resolveExpireTimestamp,
  trimFixed,
} from "@/utils/format";

const KB = 1024;
const MB = 1024 * 1024;
const GB = 1024 * 1024 * 1024;

describe("formatBytes", () => {
  it("returns '0 B' for empty / non-positive / non-finite input", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(null)).toBe("0 B");
    expect(formatBytes(undefined)).toBe("0 B");
    expect(formatBytes(-5)).toBe("0 B");
    expect(formatBytes(Number.NaN)).toBe("0 B");
    // 防回归:Infinity 不能输出成 "Infinity PB"
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe("0 B");
  });

  it("rounds raw bytes with no decimals", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1023)).toBe("1023 B");
  });

  it("scales up and adapts precision by magnitude", () => {
    expect(formatBytes(KB)).toBe("1.00 KB");
    expect(formatBytes(1.5 * KB)).toBe("1.50 KB");
    expect(formatBytes(MB)).toBe("1.00 MB");
    expect(formatBytes(100 * MB)).toBe("100 MB");
    expect(formatBytes(2.5 * GB)).toBe("2.50 GB");
  });
});

describe("formatClockTime", () => {
  it("formats local hour and minute only", () => {
    expect(formatClockTime(new Date(2026, 7, 6, 14, 32).getTime())).toBe("14:32");
    expect(formatClockTime(new Date(2026, 7, 6, 9, 5).getTime())).toBe("09:05");
  });

  it("returns an em dash for missing or non-finite timestamps", () => {
    expect(formatClockTime(null)).toBe("—");
    expect(formatClockTime(undefined)).toBe("—");
    expect(formatClockTime(Number.NaN)).toBe("—");
    expect(formatClockTime(0)).not.toBe("—");
  });
});

describe("formatTrafficRate", () => {
  it("returns a zeroed bps label for non-positive / non-finite input", () => {
    expect(formatTrafficRateLabel(0)).toBe("0 bps");
    expect(formatTrafficRateLabel(null)).toBe("0 bps");
    expect(formatTrafficRateLabel(Number.POSITIVE_INFINITY)).toBe("0 bps");
  });

  it("converts bytes/sec to bit-rate units", () => {
    // 1 MB/s = 8 Mbps
    expect(formatTrafficRateLabel(1_000_000)).toBe("8 Mbps");
    // 125 MB/s = 1 Gbps
    expect(formatTrafficRateLabel(125_000_000)).toBe("1 Gbps");
  });
});

describe("formatByteRate / formatByteRateLabel", () => {
  it("returns a zeroed B/s display for non-positive / non-finite input", () => {
    expect(formatByteRate(0)).toEqual({ value: "0", unit: "B/s" });
    expect(formatByteRate(null)).toEqual({ value: "0", unit: "B/s" });
    expect(formatByteRate(Number.POSITIVE_INFINITY)).toEqual({ value: "0", unit: "B/s" });
  });

  it("uses the byte (1024) ladder suffixed with /s", () => {
    expect(formatByteRate(512)).toEqual({ value: "512", unit: "B/s" });
    expect(formatByteRateLabel(KB)).toBe("1.00 KB/s");
    expect(formatByteRateLabel(MB)).toBe("1.00 MB/s");
    expect(formatByteRateLabel(2.5 * GB)).toBe("2.50 GB/s");
  });
});

describe("finite formatting", () => {
  it("does not expose non-finite values", () => {
    expect(trimFixed(Number.POSITIVE_INFINITY, 1)).toBe("0");
    expect(formatUptimeDays(Number.POSITIVE_INFINITY)).toEqual({ value: "—", unit: "" });
    expect(getExpireDaysRemaining("2026-06-14T12:00:00.000Z", Infinity)).toBeNull();
  });
});

describe("getExpireDaysRemaining / formatExpireDays", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-13T12:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function inDays(days: number, extraHours = 0) {
    const ts = Date.now() + days * 86_400_000 + extraHours * 3_600_000;
    return new Date(ts).toISOString();
  }

  it("returns null for missing / unparseable input", () => {
    expect(getExpireDaysRemaining(null)).toBeNull();
    expect(getExpireDaysRemaining("not-a-date")).toBeNull();
    expect(formatExpireDays(null)).toEqual({ value: "—", unit: "", tone: "none" });
  });

  it("treats Komari 'no expiry' sentinels as no-expiry, not as 已过期", () => {
    // 防回归:Go 零值时间和数字 0 / -1 这些哨兵值以前会被解析成 1 年 / 2000 / 2001 年,
    // 把永不过期的节点显示成"已过期"
    for (const sentinel of ["0001-01-01T00:00:00Z", "0", "-1", ""]) {
      expect(getExpireDaysRemaining(sentinel)).toBeNull();
      expect(formatExpireDays(sentinel)).toEqual({ value: "—", unit: "", tone: "none" });
    }
  });

  it("reads a bare positive number as a unix timestamp (seconds or ms)", () => {
    const secs = Math.floor((Date.now() + 10 * 86_400_000) / 1000);
    expect(getExpireDaysRemaining(String(secs))).toBe(10);
    const ms = Date.now() + 5 * 86_400_000;
    expect(getExpireDaysRemaining(String(ms))).toBe(5);
    // 哨兵值解析为"无时间戳"
    expect(resolveExpireTimestamp("0001-01-01T00:00:00Z")).toBeNull();
    expect(resolveExpireTimestamp(0)).toBeNull();
    expect(resolveExpireTimestamp(-1)).toBeNull();
  });

  it("maps day buckets to tones", () => {
    expect(formatExpireDays(inDays(60))).toEqual({ value: "60", unit: "天", tone: "ok" });
    expect(formatExpireDays(inDays(15))).toEqual({ value: "15", unit: "天", tone: "warn" });
    expect(formatExpireDays(inDays(3))).toEqual({ value: "3", unit: "天", tone: "critical" });
  });

  it("treats >100y as a long-term purchase", () => {
    expect(formatExpireDays(inDays(40_000))).toEqual({ value: "长期", unit: "", tone: "long" });
  });

  it("handles the today / expired boundary", () => {
    // 未来约 1 小时会向下取整成剩余 0 天
    expect(formatExpireDays(inDays(0, 1))).toEqual({ value: "今日", unit: "", tone: "critical" });
    // 已是过去时间
    expect(formatExpireDays(inDays(-2))).toEqual({ value: "已过期", unit: "", tone: "critical" });
  });
});

describe("parseTags", () => {
  it("returns [] for empty input", () => {
    expect(parseTags(null)).toEqual([]);
    expect(parseTags("")).toEqual([]);
  });

  it("parses explicit <color> suffixes and lowercases them", () => {
    expect(parseTags("VIP<RED>;Pro<Blue>")).toEqual([
      { label: "VIP", color: "red" },
      { label: "Pro", color: "blue" },
    ]);
  });

  it("infers colors for plain tags by known keywords", () => {
    expect(parseTags("CN2GIA")).toEqual([{ label: "CN2GIA", color: "blue" }]);
    expect(parseTags("4837")).toEqual([{ label: "4837", color: "green" }]);
    expect(parseTags("Random")).toEqual([{ label: "Random", color: "violet" }]);
  });

  it("handles whitespace, trailing semicolons, and empty entries gracefully", () => {
    expect(parseTags("  tag1 ; ; tag2<GREEN> ; ")).toEqual([
      { label: "tag1", color: "violet" },
      { label: "tag2", color: "green" },
    ]);
  });
});

describe("joinDisplayParts", () => {
  it("joins non-empty parts with separator and ignores empty or nullish values", () => {
    expect(joinDisplayParts(["US", "Los Angeles", null, "  ", undefined, "1 Gbps"])).toBe(
      "US · Los Angeles · 1 Gbps",
    );
    expect(joinDisplayParts([])).toBe("");
    expect(joinDisplayParts([null, undefined, ""])).toBe("");
  });
});
