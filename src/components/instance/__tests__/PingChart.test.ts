import { describe, expect, it } from "vitest";
import { summarizePingRecords } from "@/components/instance/PingChart";
import { resolvePingRecordLossPercent } from "@/utils/pingMetrics";
import type { PingRecord } from "@/types/komari";

function record(
  time: string,
  value: number,
  count: number,
  loss: number,
): PingRecord {
  return { task_id: 1, client: "node-a", time, value, count, loss };
}

describe("summarizePingRecords", () => {
  it("weights aggregate latency and loss by the represented sample counts", () => {
    const summary = summarizePingRecords([
      record("2026-01-01T00:00:00Z", 10, 10, 0),
      record("2026-01-01T00:01:00Z", 100, 2, 50),
      record("2026-01-01T00:02:00Z", -1, 5, 100),
    ]);

    expect(summary).toMatchObject({
      latest: 100,
      min: 10,
      max: 100,
      p50: 10,
      total: 17,
      lost: 6,
    });
    expect(summary.avg).toBeCloseTo(200 / 11, 8);
    expect(summary.p99).toBeCloseTo(91, 8);
    expect(summary.loss).toBeCloseTo((6 / 17) * 100, 8);
  });
});

describe("resolvePingRecordLossPercent", () => {
  it("keeps an explicit aggregate loss percentage", () => {
    expect(resolvePingRecordLossPercent(record("2026-01-01T00:00:00Z", 20, 20, 5))).toBe(5);
  });

  it("draws legacy successful samples at 0% and lost samples at 100%", () => {
    const success: PingRecord = {
      task_id: 1,
      client: "node-a",
      time: "2026-01-01T00:00:00Z",
      value: 20,
    };
    const lost = { ...success, value: -1 };

    expect(resolvePingRecordLossPercent(success)).toBe(0);
    expect(resolvePingRecordLossPercent(lost)).toBe(100);
  });

  it("clamps malformed explicit percentages into the chart range", () => {
    expect(resolvePingRecordLossPercent(record("2026-01-01T00:00:00Z", 20, 1, 120))).toBe(100);
    expect(resolvePingRecordLossPercent(record("2026-01-01T00:00:00Z", 20, 1, -5))).toBe(0);
  });
});
