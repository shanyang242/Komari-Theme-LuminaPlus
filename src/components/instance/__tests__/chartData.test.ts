import { describe, expect, it } from "vitest";
import {
  cutPeakValues,
  downsampleAligned,
  fillMissingMetricPoints,
  insertMetricGapSentinels,
  mergeRealtimeMetricPoints,
  type TimedMetricPoint,
} from "@/components/instance/chartData";

describe("fillMissingMetricPoints", () => {
  it("keeps the newest sample's own timestamp instead of snapping it to the grid", () => {
    const points: TimedMetricPoint[] = [
      { time: 0, v: 1 },
      { time: 10, v: 2 },
      { time: 20, v: 3 },
      { time: 35, v: 9 },
    ];
    const filled = fillMissingMetricPoints(points, { intervalSeconds: 10, matchToleranceSeconds: 5 });
    const last = filled[filled.length - 1];
    expect(last.time).toBe(35);
    expect(last.v).toBe(9);
  });

  it("leaves on-grid series untouched at the trailing edge", () => {
    const points: TimedMetricPoint[] = [
      { time: 0, v: 1 },
      { time: 10, v: 2 },
      { time: 20, v: 3 },
    ];
    const filled = fillMissingMetricPoints(points, { intervalSeconds: 10, matchToleranceSeconds: 5 });
    expect(filled.map((p) => p.time)).toEqual([0, 10, 20]);
    expect(filled[filled.length - 1].v).toBe(3);
  });

  it("keeps a trailing sample outside the final grid tolerance", () => {
    const points: TimedMetricPoint[] = [
      { time: 0, v: 1 },
      { time: 10, v: 2 },
      { time: 20, v: 3 },
      { time: 36, v: 4 },
    ];

    const filled = fillMissingMetricPoints(points, {
      intervalSeconds: 10,
      matchToleranceSeconds: 5,
    });

    expect(filled.map((point) => point.time)).toEqual([0, 10, 20, 30, 36]);
    expect(filled[filled.length - 1].v).toBe(4);
  });

  it("prefers an exact trailing sample over an earlier point snapped to the same grid time", () => {
    const filled = fillMissingMetricPoints(
      [
        { time: 0, v: 1 },
        { time: 10, v: 2 },
        { time: 16, v: 3 },
        { time: 20, v: 4 },
      ],
      { intervalSeconds: 10, matchToleranceSeconds: 5 },
    );

    expect(filled[filled.length - 1]).toMatchObject({ time: 20, v: 4 });
  });
});
describe("cutPeakValues", () => {
  it("preserves genuine loss gaps instead of backfilling them (regression)", () => {
    const points = [
      { time: 1, t1: 50 },
      { time: 2, t1: 52 },
      { time: 3, t1: null },
      { time: 4, t1: 51 },
      { time: 5, t1: 50 },
    ];

    const out = cutPeakValues(points, ["t1"]);

    expect(out[2].t1).toBeNull();
    expect(typeof out[0].t1).toBe("number");
    expect(typeof out[4].t1).toBe("number");
  });

  it("does not invent values across a multi-point outage", () => {
    const points = [
      { time: 1, t1: 40 },
      { time: 2, t1: null },
      { time: 3, t1: null },
      { time: 4, t1: null },
      { time: 5, t1: 42 },
    ];

    const out = cutPeakValues(points, ["t1"]);

    expect(out[1].t1).toBeNull();
    expect(out[2].t1).toBeNull();
    expect(out[3].t1).toBeNull();
  });
});

describe("insertMetricGapSentinels — three-state ping semantics", () => {
  const opts = (intervals: Record<string, number>) => ({
    intervals: new Map(Object.entries(intervals)),
    matchToleranceRatio: 0.25,
  });
  const at = (points: TimedMetricPoint[], time: number) =>
    points.find((point) => point.time === time);

  it("keeps an off-phase anchor as undefined (spannable), not null", () => {
    const points: TimedMetricPoint[] = [
      { time: 0, A: 10 },
      { time: 30, B: 20 },
      { time: 60, A: 11 },
      { time: 90, B: 21 },
      { time: 120, A: 12 },
      { time: 150, B: 22 },
    ];

    const out = insertMetricGapSentinels(points, opts({ A: 60, B: 60 }));

    const p0 = at(out, 0)!;
    expect(p0.A).toBe(10);
    expect(p0.B).toBeUndefined();
    const p30 = at(out, 30)!;
    expect(p30.B).toBe(20);
    expect(p30.A).toBeUndefined();
  });

  it("preserves real loss (null) as a break", () => {
    const points: TimedMetricPoint[] = [
      { time: 0, A: 10 },
      { time: 60, A: null },
      { time: 120, A: 12 },
    ];

    const out = insertMetricGapSentinels(points, opts({ A: 60 }));

    expect(at(out, 60)!.A).toBeNull();
  });

  it("tolerates a single missed sample (gap <= 2x interval)", () => {
    const points: TimedMetricPoint[] = [
      { time: 0, A: 10 },
      { time: 120, A: 12 },
      { time: 180, A: 13 },
    ];

    const out = insertMetricGapSentinels(points, opts({ A: 60 }));

    expect(out.every((point) => point.A !== null)).toBe(true);
  });

  it("bridges up to two consecutive missed samples (gap <= 3x interval)", () => {
    const points: TimedMetricPoint[] = [
      { time: 0, A: 10 },
      { time: 180, A: 13 },
      { time: 240, A: 14 },
    ];

    const out = insertMetricGapSentinels(points, opts({ A: 60 }));

    expect(out.every((point) => point.A !== null)).toBe(true);
  });

  it("breaks once the gap exceeds 6x interval", () => {
    const points: TimedMetricPoint[] = [
      { time: 0, A: 10 },
      { time: 420, A: 14 },
      { time: 480, A: 15 },
    ];

    const out = insertMetricGapSentinels(points, opts({ A: 60 }));

    expect(out.some((point) => point.A === null)).toBe(true);
  });

  it("breaks only the gapped task on a long outage, sparing co-located anchors", () => {
    const points: TimedMetricPoint[] = [
      { time: 0, A: 10, B: 100 },
      { time: 60, A: 11, B: 101 },
      { time: 120, B: 102 },
      { time: 180, B: 103 },
      { time: 240, B: 104 },
      { time: 300, B: 105 },
      { time: 360, B: 106 },
      { time: 420, B: 107 },
      { time: 480, A: 15, B: 108 },
    ];

    const out = insertMetricGapSentinels(points, opts({ A: 60, B: 60 }));

    const p120 = at(out, 120)!;
    expect(p120.A).toBeNull();
    expect(p120.B).toBe(102);
  });

  it("merges sentinels when multiple tasks gap at the same time", () => {
    const points: TimedMetricPoint[] = [
      { time: 0, A: 10, B: 100 },
      { time: 60, A: 11, B: 101 },
      { time: 480, A: 15, B: 105 },
    ];

    const out = insertMetricGapSentinels(points, opts({ A: 60, B: 60 }));

    const p120 = at(out, 120)!;
    expect(p120).toBeDefined();
    expect(p120!.A).toBeNull();
    expect(p120!.B).toBeNull();
  });
});

describe("downsampleAligned", () => {
  it("keeps a real null break even when the same bucket also contains numeric samples", () => {
    const out = downsampleAligned(
      [0, 10, 20, 30],
      [[10, null, 14, 16]],
      2,
    );

    expect(out.times).toHaveLength(2);
    expect(out.perTask[0][0]).toBeNull();
    expect(out.perTask[0][1]).toBe(15);
  });

  it("keeps the Ping latency trend when one sample in a bucket was lost", () => {
    const out = downsampleAligned(
      [0, 10, 20, 30, 40, 50],
      [[10, null, 14, null, null, null]],
      2,
      false,
      "all",
    );

    expect(out.perTask[0]).toEqual([12, null]);
  });

  it("keeps off-phase-only buckets undefined", () => {
    const out = downsampleAligned(
      [0, 10, 20, 30],
      [[undefined, undefined, 14, 16]],
      2,
    );

    expect(out.perTask[0][0]).toBeUndefined();
    expect(out.perTask[0][1]).toBe(15);
  });

  it("averages by default but pushes through a real spike when preservePeaks=true", () => {
    const mean = downsampleAligned([0, 10, 20, 30], [[50, 500, 50, 52]], 2);
    expect(mean.perTask[0][0]).toBe(275);

    const peak = downsampleAligned([0, 10, 20, 30], [[50, 500, 50, 52]], 2, true);
    expect(peak.perTask[0][0]).toBe(500);
    expect(peak.perTask[0][1]).toBe(51);
  });

  it("still prioritizes null breaks over peaks in preservePeaks mode", () => {
    const out = downsampleAligned([0, 10, 20, 30], [[50, null, 14, 16]], 2, true);
    expect(out.perTask[0][0]).toBeNull();
    expect(out.perTask[0][1]).toBe(15);
  });
});

describe("mergeRealtimeMetricPoints", () => {
  it("appends cleanly on the disjoint ascending fast path", () => {
    const history = [{ time: 100 }, { time: 110 }, { time: 120 }];
    const realtime = [{ time: 122 }, { time: 125 }];
    expect(mergeRealtimeMetricPoints(history, realtime, 10).map((p) => p.time)).toEqual([
      100, 110, 120, 122, 125,
    ]);
  });

  it("preserves interleaved history points instead of truncating after the first realtime sample (regression)", () => {
    const history = [{ time: 100 }, { time: 110 }, { time: 120 }];
    const realtime = [{ time: 105 }, { time: 125 }];
    expect(mergeRealtimeMetricPoints(history, realtime, 10).map((p) => p.time)).toEqual([
      100, 105, 110, 120, 125,
    ]);
  });

  it("restores monotonic order when realtime samples arrive out of order (regression)", () => {
    const history = [{ time: 100 }, { time: 110 }, { time: 120 }];
    const realtime = [{ time: 130 }, { time: 122 }];
    expect(mergeRealtimeMetricPoints(history, realtime, 10).map((p) => p.time)).toEqual([
      100, 110, 120, 122, 130,
    ]);
    expect(mergeRealtimeMetricPoints([], realtime, 10).map((p) => p.time)).toEqual([122, 130]);
  });

  it("dedupes sub-second overlapping samples and enforces the sample limit", () => {
    const history = [{ time: 100, v: 1 }, { time: 110, v: 2 }];
    const realtime = [{ time: 110.4, v: 3 }, { time: 115, v: 4 }];
    const merged = mergeRealtimeMetricPoints(history, realtime, 2);
    expect(merged).toEqual([
      { time: 110.4, v: 3 },
      { time: 115, v: 4 },
    ]);
  });
});
