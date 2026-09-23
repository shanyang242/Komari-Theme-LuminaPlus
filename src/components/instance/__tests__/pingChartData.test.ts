import { describe, expect, it } from "vitest";
import type { PingRecord } from "@/types/komari";
import { alignPingChartRecords } from "../pingChartData";

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

    expect(result.lossPoints).toEqual([{ time: 0.2, "1": 50, "2": 0 }]);
    expect(result.lossWeightMap.get(0.2)).toEqual({ time: 0.2, "1": 2, "2": 1 });
    expect(result.latencyPoints[0]["2"]).toBe(0);
  });
});
