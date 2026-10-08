import { describe, expect, it } from "vitest";
import type { PingRecord } from "@/types/komari";
import { downsampleWeightedAligned, insertMetricGapSentinels } from "../chartData";
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
  it("retains losses when a successful sample shares the same time anchor", () => {
    const records = [0, 0.5, 2, 2.5, 4, 4.5].map((time, index) =>
      sample(time, index % 2 === 0 ? -1 : 20),
    );
    const result = alignPingChartRecords(records, new Set(["1"]), 0.8);

    expect(result.lossPoints.map((point) => point["1"])).toEqual([50, 50, 50]);
    expect([...result.lossWeightMap.values()].map((point) => point["1"])).toEqual([2, 2, 2]);
  });

  it("preserves aggregate sample weights through alignment and downsampling", () => {
    const result = alignPingChartRecords(
      [
        sample(0, -1, { count: 1, loss: 100 }),
        sample(0.5, 20, { count: 59, loss: 0 }),
        sample(2, -1, { count: 3, loss: 100 }),
      ],
      new Set(["1"]),
      0.8,
    );
    const points = insertMetricGapSentinels(result.lossPoints, { defaultInterval: 1 });
    const reduced = downsampleWeightedAligned(
      points.map((point) => point.time),
      [points.map((point) => point["1"])],
      [points.map((point) => result.lossWeightMap.get(point.time)?.["1"])],
      1,
    );

    expect(result.lossPoints[0]["1"]).toBeCloseTo(100 / 60, 8);
    expect(result.lossWeightMap.get(0)?.["1"]).toBe(60);
    expect(reduced.perTask[0][0]).toBeCloseTo((4 / 63) * 100, 8);
  });

  it("keeps task weights independent and excludes records from unlisted tasks", () => {
    const result = alignPingChartRecords(
      [
        sample(0, -1, { task_id: 99 }),
        sample(0.2, -1, { count: 2 }),
        sample(0.3, 0, { task_id: 2, count: 59 }),
        sample(0.4, 20, { count: 2 }),
      ],
      new Set(["1", "2"]),
      0.8,
    );

    expect(result.lossPoints).toEqual([{ time: 0.2, "1": 50, "2": 0 }]);
    expect(result.lossWeightMap.get(0.2)).toEqual({ time: 0.2, "1": 4, "2": 59 });
    expect(result.latencyPoints[0]["2"]).toBe(0);
  });
});

describe("pingLossMarkers", () => {
  it.each([1, 6, 24, 168, 720])("retains isolated and partial losses over %s hours", (hours) => {
    const records = Array.from({ length: 1000 }, (_, i) =>
      sample(1 + i * hours * 3.6, i === 501 ? -1 : 20,
        i === 802 ? { count: 1000, loss: 0.01 } : {}));
    expect(pingLossMarkers(records, new Set([1])))
      .toEqual([{ time: records[501].time, taskId: 1 }, { time: records[802].time, taskId: 1 }]);
  });

  it("excludes hidden tasks, invalid times and successes, and deduplicates timestamps", () => {
    expect(pingLossMarkers([
      sample(1, 0), sample(2, -1), sample(2, -1),
      sample(3, -1, { task_id: 2 }),
    ].concat({ time: NaN, record: sample(4, -1).record }), new Set([1])))
      .toEqual([{ time: 2, taskId: 1 }]);
  });
});

it("retains both task identities when losses occur at the same timestamp", () => {
  expect(pingLossMarkers([sample(2, -1), sample(2, -1, { task_id: 2 })], new Set([1, 2])))
    .toEqual([{ time: 2, taskId: 1 }, { time: 2, taskId: 2 }]);
});
