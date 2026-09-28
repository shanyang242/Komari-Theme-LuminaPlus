import { describe, expect, it } from "vitest";
import type { PingRecord } from "@/types/komari";
import { alignPingChartRecords, pingLossMarkers } from "../pingChartData";

function sample(time: number, value: number, extra: Partial<PingRecord> = {}) {
  return {
    time,
    record: {
      task_id: 1,
      client: "node-a",
      time: new Date(time * 1000).toISOString(),
      value,
      ...extra,
    },
  };
}

describe("alignPingChartRecords", () => {
  it("aligns successful latency samples when they share the same time anchor", () => {
    const records = [0, 0.5, 2, 2.5, 4, 4.5].map((time, index) =>
      sample(time, index % 2 === 0 ? -1 : 20),
    );
    const result = alignPingChartRecords(records, new Set(["1"]), 0.8);

    expect(result.latencyPoints.map((point) => point["1"])).toEqual([20, 20, 20]);
  });

  it("keeps tasks independent and excludes records from unlisted tasks", () => {
    const result = alignPingChartRecords(
      [
        sample(0, -1, { task_id: 99 }),
        sample(0.2, -1),
        sample(0.3, 0, { task_id: 2 }),
        sample(0.4, 20),
      ],
      new Set(["1", "2"]),
      0.8,
    );

    expect(result.latencyPoints).toEqual([{ time: 0.2, "1": 20, "2": 0 }]);
    expect(result.latencyPoints[0]["2"]).toBe(0);
  });
});

describe("pingLossMarkers", () => {
  it("retains isolated and aggregated partial losses across time ranges", () => {
    for (const hours of [1, 4, 24, 168]) {
      const records = Array.from({ length: 1000 }, (_, index) =>
        sample(1 + index * hours * 3.6, index === 501 ? -1 : 20,
          index === 802 ? { loss: 1 } as Partial<PingRecord> : {}));
      expect(pingLossMarkers(records, new Set([1]))).toEqual([
        { time: records[501].time, taskId: 1 },
        { time: records[802].time, taskId: 1 },
      ]);
    }
  });

  it("excludes hidden tasks, invalid times and successes, and deduplicates timestamps", () => {
    expect(pingLossMarkers([
      sample(1, 0), sample(2, -1), sample(2, -1),
      sample(3, -1, { task_id: 2 }),
      { ...sample(4, -1), time: Number.NaN },
    ], new Set([1]))).toEqual([{ time: 2, taskId: 1 }]);
  });

  it("retains both task identities when losses occur at the same timestamp", () => {
    expect(pingLossMarkers([
      sample(2, -1), sample(2, -1, { task_id: 2 }),
    ], new Set([1, 2]))).toEqual([
      { time: 2, taskId: 1 },
      { time: 2, taskId: 2 },
    ]);
  });
});
