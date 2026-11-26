import { describe, expect, it } from "vitest";
import {
  fillMetricBoundaryGaps,
  getMetricBoundaryRepairRange,
  hasMetricBoundaryGap,
  type MetricBoundarySeries,
} from "@/utils/metricBoundaryRepair";

const END = Date.parse("2026-07-15T04:00:00Z");

function series(
  points: MetricBoundarySeries["points"],
  overrides: Partial<MetricBoundarySeries> = {},
): MetricBoundarySeries {
  return {
    metricKey: "ping.latency_ms",
    client: "node-a",
    tags: { task_id: "7" },
    intervalSeconds: 60,
    points,
    ...overrides,
  };
}

describe("metric boundary repair", () => {
  it("limits the raw query to the five-minute compaction lag plus one-minute margin", () => {
    expect(getMetricBoundaryRepairRange(END - 60 * 60 * 1000, END)).toEqual({
      startMs: END - 20 * 60 * 1000,
      endMs: END - 14 * 60 * 1000,
    });
    expect(getMetricBoundaryRepairRange(END - 10 * 60 * 1000, END)).toBeNull();
  });

  it("detects both fill-empty buckets and omitted bucket gaps near the boundary", () => {
    const range = getMetricBoundaryRepairRange(END - 60 * 60 * 1000, END)!;
    expect(
      hasMetricBoundaryGap(
        [
          series([
            { time: "2026-07-15T03:43:00Z", value: 20, count: 1 },
            { time: "2026-07-15T03:44:00Z", value: null, count: 0 },
          ]),
        ],
        range,
      ),
    ).toBe(true);
    expect(
      hasMetricBoundaryGap(
        [
          series([
            { time: "2026-07-15T03:43:00Z", value: 20, count: 1 },
            { time: "2026-07-15T03:47:00Z", value: 22, count: 1 },
          ]),
        ],
        range,
      ),
    ).toBe(true);
  });

  it("fills an empty average bucket from raw samples without touching populated buckets", () => {
    const aggregate = series([
      { time: "2026-07-15T03:43:00Z", value: 10, count: 2 },
      { time: "2026-07-15T03:44:00Z", value: null, count: 0 },
    ]);
    const raw = series([
      { time: "2026-07-15T03:43:10Z", value: 100, count: 0 },
      { time: "2026-07-15T03:44:10Z", value: 20, count: 0 },
      { time: "2026-07-15T03:44:40Z", value: 40, count: 0 },
    ]);

    const repaired = fillMetricBoundaryGaps([aggregate], [raw]);
    expect(repaired.repairedSamples).toBe(2);
    expect(repaired.series[0].points).toEqual([
      { time: "2026-07-15T03:43:00Z", value: 10, count: 2 },
      { time: "2026-07-15T03:44:00Z", value: 30, count: 2 },
    ]);
  });

  it("repairs buckets whose positive count has no finite value", () => {
    const aggregate = series([
      { time: "2026-07-15T03:44:00Z", value: null, count: 2 },
      { time: "2026-07-15T03:45:00Z", value: Number.POSITIVE_INFINITY, count: 1 },
    ]);
    const raw = series([
      { time: "2026-07-15T03:44:20Z", value: 20, count: 0 },
      { time: "2026-07-15T03:45:20Z", value: 40, count: 0 },
    ]);

    const repaired = fillMetricBoundaryGaps([aggregate], [raw]);
    expect(repaired.series[0].points).toEqual([
      { time: "2026-07-15T03:44:00Z", value: 20, count: 1 },
      { time: "2026-07-15T03:45:00Z", value: 40, count: 1 },
    ]);
  });

  it("uses the latest raw value for last-value metrics and can restore omitted buckets", () => {
    const aggregate = series([], {
      metricKey: "memory.total",
      tags: undefined,
    });
    const raw = series(
      [
        { time: "2026-07-15T03:44:10Z", value: 100, count: 0 },
        { time: "2026-07-15T03:44:50Z", value: 120, count: 0 },
      ],
      { metricKey: "memory.total", tags: undefined },
    );

    const repaired = fillMetricBoundaryGaps([aggregate], [raw], {
      "memory.total": "last",
    });
    expect(repaired.series[0].points).toEqual([
      { time: "2026-07-15T03:44:00.000Z", value: 120, count: 2 },
    ]);
  });

  it("supports sum and max repairs used by daily traffic statistics", () => {
    const raw = series([
      { time: "2026-07-15T03:44:10Z", value: 20, count: 0 },
      { time: "2026-07-15T03:44:50Z", value: 40, count: 0 },
    ]);
    expect(fillMetricBoundaryGaps([], [raw], { "ping.latency_ms": "sum" }).series[0].points[0])
      .toMatchObject({ value: 60, count: 2 });
    expect(fillMetricBoundaryGaps([], [raw], { "ping.latency_ms": "max" }).series[0].points[0])
      .toMatchObject({ value: 40, count: 2 });
  });

  it("weights hybrid average values by their server sample counts", () => {
    const aggregate = series([
      { time: "2026-07-15T03:44:00Z", value: null, count: 0 },
    ]);
    const hybrid = series([
      { time: "2026-07-15T03:44:10Z", value: 20, count: 5 },
      { time: "2026-07-15T03:44:40Z", value: 100, count: 1 },
    ]);

    const repaired = fillMetricBoundaryGaps([aggregate], [hybrid]);
    expect(repaired.repairedSamples).toBe(6);
    expect(repaired.series[0].points[0]).toMatchObject({
      time: "2026-07-15T03:44:00Z",
      count: 6,
    });
    expect(repaired.series[0].points[0]?.value).toBeCloseTo(200 / 6);
  });

  it("sorts valid points chronologically even when an invalid timestamp point is present", () => {
    const aggregate = series([
      { time: "2026-07-15T03:45:00Z", value: 25, count: 1 },
      { time: "not-a-timestamp", value: 99, count: 1 },
      { time: "2026-07-15T03:43:00Z", value: 10, count: 1 },
      { time: "2026-07-15T03:44:00Z", value: null, count: 0 },
    ]);
    const raw = series([{ time: "2026-07-15T03:44:10Z", value: 18, count: 0 }]);

    const repaired = fillMetricBoundaryGaps([aggregate], [raw]);
    expect(repaired.series[0].points.map((point) => point.time)).toEqual([
      "2026-07-15T03:43:00Z",
      "2026-07-15T03:44:00Z",
      "2026-07-15T03:45:00Z",
      "not-a-timestamp",
    ]);
  });
});
