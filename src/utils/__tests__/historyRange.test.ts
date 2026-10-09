import { describe, expect, it } from "vitest";
import {
  historyChartRangeSeconds,
  historyCoverageLabel,
  inferHistoryIntervalSeconds,
} from "@/utils/historyRange";

const HOUR = 60 * 60 * 1000;

describe("history range metadata", () => {
  it("converts the requested API range into a fixed chart range", () => {
    expect(
      historyChartRangeSeconds({ rangeStartMs: 1_000_000, rangeEndMs: 4_600_000 }),
    ).toEqual([1_000, 4_600]);
    expect(
      historyChartRangeSeconds({ rangeStartMs: 4_600_000, rangeEndMs: 1_000_000 }),
    ).toBeNull();
  });

  it("rejects inverted actual coverage", () => {
    expect(
      historyCoverageLabel(
        { rangeStartMs: 1_000_000, rangeEndMs: 4_600_000, intervalSeconds: 60 },
        4_000,
        2_000,
      ),
    ).toBeNull();
  });

  it("makes incomplete retention coverage explicit", () => {
    const end = Date.UTC(2026, 6, 13);
    const start = end - 7 * 24 * HOUR;
    const actualStart = end - 2 * 24 * HOUR;
    expect(
      historyCoverageLabel(
        { rangeStartMs: start, rangeEndMs: end, intervalSeconds: 15 * 60 },
        actualStart / 1000,
        end / 1000,
      ),
    ).toBe("实际覆盖 2 天 / 7 天");
  });

  it("treats one aggregation interval of edge loss as full coverage", () => {
    const end = Date.UTC(2026, 6, 13);
    const start = end - 24 * HOUR;
    expect(
      historyCoverageLabel(
        { rangeStartMs: start, rangeEndMs: end, intervalSeconds: 15 * 60 },
        (start + 15 * 60 * 1000) / 1000,
        (end - 15 * 60 * 1000) / 1000,
      ),
    ).toBe("覆盖完整 1 天");
  });

  it("infers the sampling interval so a complete window is not reported as partial", () => {
    const end = Date.UTC(2026, 6, 13);
    const records = Array.from({ length: 12 }, (_, index) => ({
      time: end - (11 - index) * 5 * 60_000,
    }));
    const intervalSeconds = inferHistoryIntervalSeconds(records);
    expect(intervalSeconds).toBe(5 * 60);
    expect(
      historyCoverageLabel(
        { rangeStartMs: end - HOUR, rangeEndMs: end, intervalSeconds },
        records[0].time / 1000,
        records[records.length - 1].time / 1000,
      ),
    ).toBe("覆盖完整 1 小时");
  });
});
