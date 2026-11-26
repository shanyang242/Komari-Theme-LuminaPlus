import { describe, expect, it } from "vitest";
import type { LoadRecord } from "@/types/komari";
import {
  buildTodayTrafficMetricSamples,
  buildTodayTrafficMetricSamplesByUuid,
  buildTodayTrafficRecordSamples,
  RATE_DOWN_METRIC,
  RATE_UP_METRIC,
  summarizeTodayTrafficMetrics,
  summarizeTodayTrafficRecords,
  summarizeTodayTrafficRecordsWithSamples,
  TRAFFIC_DOWN_METRIC,
  TRAFFIC_UP_METRIC,
  type TrafficMetricSeries,
} from "@/utils/trafficStats";

function metricSeries(
  metricKey: string,
  values: Array<[string, number | null, number?]>,
): TrafficMetricSeries {
  return {
    metricKey,
    client: "node-a",
    intervalSeconds: 300,
    points: values.map(([time, value, count = 1]) => ({ time, value, count })),
  };
}

function record(time: string, overrides: Partial<LoadRecord> = {}): LoadRecord {
  return {
    cpu: 0,
    gpu: 0,
    ram: 0,
    ram_total: 0,
    swap: 0,
    swap_total: 0,
    load: 0,
    temp: 0,
    disk: 0,
    disk_total: 0,
    net_in: 0,
    net_out: 0,
    net_total_up: 0,
    net_total_down: 0,
    process: 0,
    connections: 0,
    connections_udp: 0,
    client: "node-a",
    time,
    ...overrides,
  };
}

describe("today traffic stats", () => {
  it("sums traffic buckets and keeps the timestamp of each direction peak", () => {
    const stats = summarizeTodayTrafficMetrics(
      [
        metricSeries(TRAFFIC_UP_METRIC, [
          ["2026-07-16T00:00:00Z", 100],
          ["2026-07-16T00:05:00Z", 50],
        ]),
        metricSeries(TRAFFIC_DOWN_METRIC, [["2026-07-16T00:00:00Z", 300]]),
        metricSeries(RATE_UP_METRIC, [
          ["2026-07-16T00:00:00Z", 10],
          ["2026-07-16T00:05:00Z", 25],
        ]),
        metricSeries(RATE_DOWN_METRIC, [
          ["2026-07-16T00:00:00Z", 40],
          ["2026-07-16T00:05:00Z", 30],
        ]),
      ],
      ["node-a", "node-b"],
    );

    expect(stats[0]).toMatchObject({
      trafficUp: 150,
      trafficDown: 300,
      peakUp: 25,
      peakUpAt: Date.parse("2026-07-16T00:05:00Z"),
      peakDown: 40,
      peakDownAt: Date.parse("2026-07-16T00:00:00Z"),
      sampleCount: 2,
      hasSamples: true,
    });
    expect(stats[1]).toMatchObject({ uuid: "node-b", hasSamples: false, sampleCount: 0 });
  });

  it("derives counter deltas across resets for the compatibility path", () => {
    const start = Date.parse("2026-07-16T00:00:00Z");
    const stats = summarizeTodayTrafficRecords(
      "node-a",
      [
        record("2026-07-15T23:55:00Z", { net_total_up: 100, net_total_down: 200 }),
        record("2026-07-16T00:05:00Z", {
          net_total_up: 150,
          net_total_down: 260,
          net_out: 12,
          net_in: 24,
        }),
        record("2026-07-16T00:10:00Z", {
          net_total_up: 20,
          net_total_down: 30,
          net_out: 30,
          net_in: 18,
        }),
      ],
      start,
      Date.parse("2026-07-16T01:00:00Z"),
    );

    expect(stats).toMatchObject({
      trafficUp: 70,
      trafficDown: 90,
      peakUp: 30,
      peakDown: 24,
      sampleCount: 2,
      hasSamples: true,
    });
  });

  it("ignores zero glitch frames and minor counter dips without inflating today traffic", () => {
    const start = Date.parse("2026-07-16T00:00:00Z");
    const end = Date.parse("2026-07-16T01:00:00Z");
    const stats = summarizeTodayTrafficRecords(
      "node-a",
      [
        record("2026-07-15T23:55:00Z", { net_total_up: 100, net_total_down: 500 }),
        // 零值帧不得重置基线，恢复到 100.1 只计 0.1
        record("2026-07-16T00:05:00Z", { net_total_up: 0, net_total_down: 0 }),
        record("2026-07-16T00:10:00Z", { net_total_up: 100.1, net_total_down: 499.9 }),
        // 微小回落不视作重启归零，后续回升只计超过原高水位的部分
        record("2026-07-16T00:15:00Z", { net_total_up: 99.9, net_total_down: 500.5 }),
        record("2026-07-16T00:20:00Z", { net_total_up: 100.6, net_total_down: 500.5 }),
      ],
      start,
      end,
    );

    expect(stats.trafficUp).toBeCloseTo(0.6, 8);
    expect(stats.trafficDown).toBeCloseTo(0.5, 8);
  });

  it("does not establish a zero baseline from a leading zero glitch frame", () => {
    const start = Date.parse("2026-07-16T00:00:00Z");
    const end = Date.parse("2026-07-16T01:00:00Z");
    const stats = summarizeTodayTrafficRecords(
      "node-a",
      [
        record("2026-07-16T00:05:00Z", { net_total_up: 0, net_total_down: 0 }),
        record("2026-07-16T00:10:00Z", { net_total_up: 10_000_000, net_total_down: 20_000_000 }),
        record("2026-07-16T00:15:00Z", { net_total_up: 10_000_500, net_total_down: 20_000_800 }),
      ],
      start,
      end,
    );

    expect(stats.trafficUp).toBe(500);
    expect(stats.trafficDown).toBe(800);
  });

  it("still counts a genuine reset after an intermediate zero frame and parses numeric string timestamps", () => {
    const start = Date.parse("2026-07-16T00:00:00Z");
    const end = Date.parse("2026-07-16T01:00:00Z");
    const t0 = String(Math.floor(Date.parse("2026-07-15T23:55:00Z") / 1000));
    const t1 = String(Date.parse("2026-07-16T00:05:00Z"));
    const t2 = String(Math.floor(Date.parse("2026-07-16T00:10:00Z") / 1000));
    const t3 = String(Date.parse("2026-07-16T00:15:00Z"));
    const stats = summarizeTodayTrafficRecords(
      "node-a",
      [
        record(t0, { net_total_up: 150, net_total_down: 200 }),
        record(t1, { net_total_up: 0, net_total_down: 0 }),
        record(t2, { net_total_up: 20, net_total_down: 30 }),
        record(t3, { net_total_up: 35, net_total_down: 45 }),
      ],
      start,
      end,
    );

    expect(stats.trafficUp).toBe(35);
    expect(stats.trafficDown).toBe(45);
    expect(stats.sampleCount).toBe(3);
  });

  it("does not assign a pseudo peak timestamp when every rate sample is zero", () => {
    const metricStat = summarizeTodayTrafficMetrics(
      [
        metricSeries(RATE_UP_METRIC, [["2026-07-16T00:05:00Z", 0]]),
        metricSeries(RATE_DOWN_METRIC, [["2026-07-16T00:05:00Z", 0]]),
      ],
      ["node-a"],
    )[0];
    const recordStat = summarizeTodayTrafficRecords(
      "node-a",
      [record("2026-07-16T00:05:00Z")],
      Date.parse("2026-07-16T00:00:00Z"),
      Date.parse("2026-07-16T01:00:00Z"),
    );

    expect(metricStat).toMatchObject({
      peakUp: 0,
      peakUpAt: null,
      peakDown: 0,
      peakDownAt: null,
    });
    expect(recordStat).toMatchObject({
      peakUp: 0,
      peakUpAt: null,
      peakDown: 0,
      peakDownAt: null,
    });
  });

  it("builds newest-first upload and download samples for the detail table", () => {
    const metricSamples = buildTodayTrafficMetricSamples(
      [
        metricSeries(RATE_UP_METRIC, [
          ["2026-07-16T00:00:00Z", 10],
          ["2026-07-16T00:05:00Z", 20],
        ]),
        metricSeries(RATE_DOWN_METRIC, [
          ["2026-07-16T00:00:00Z", 30],
          ["2026-07-16T00:05:00Z", 40],
        ]),
      ],
      "node-a",
    );

    expect(metricSamples).toEqual([
      { timeMs: Date.parse("2026-07-16T00:05:00Z"), up: 20, down: 40 },
      { timeMs: Date.parse("2026-07-16T00:00:00Z"), up: 10, down: 30 },
    ]);

    const recordSamples = buildTodayTrafficRecordSamples(
      [
        record("2026-07-15T23:55:00Z", { net_out: 1, net_in: 2 }),
        record("2026-07-16T00:05:00Z", { net_out: 3, net_in: 4 }),
      ],
      Date.parse("2026-07-16T00:00:00Z"),
      Date.parse("2026-07-16T01:00:00Z"),
    );
    expect(recordSamples).toEqual([
      { timeMs: Date.parse("2026-07-16T00:05:00Z"), up: 3, down: 4 },
    ]);
  });

  it("extracts samples for multiple nodes in a single pass matching per-node extraction", () => {
    const series: TrafficMetricSeries[] = [
      metricSeries(RATE_UP_METRIC, [
        ["2026-07-16T00:00:00Z", 10],
        ["2026-07-16T00:05:00Z", 20],
      ]),
      {
        ...metricSeries(RATE_DOWN_METRIC, [["2026-07-16T00:00:00Z", 99]]),
        client: "node-b",
      },
      metricSeries(RATE_DOWN_METRIC, [["2026-07-16T00:05:00Z", 40]]),
    ];

    const grouped = buildTodayTrafficMetricSamplesByUuid(series, ["node-a", "node-b", "node-c"]);
    expect(grouped["node-a"]).toEqual(buildTodayTrafficMetricSamples(series, "node-a"));
    expect(grouped["node-b"]).toEqual(buildTodayTrafficMetricSamples(series, "node-b"));
    expect(grouped["node-c"]).toEqual([]);

    const start = Date.parse("2026-07-16T00:00:00Z");
    const end = Date.parse("2026-07-16T01:00:00Z");
    const records = [
      record("2026-07-16T00:05:00Z", { net_total_up: 100, net_out: 15, net_in: 25 }),
      record("2026-07-16T00:10:00Z", { net_total_up: 180, net_out: 30, net_in: 12 }),
    ];
    const combined = summarizeTodayTrafficRecordsWithSamples("node-a", records, start, end);
    expect(combined.stat).toEqual(summarizeTodayTrafficRecords("node-a", records, start, end));
    expect(combined.samples).toEqual(buildTodayTrafficRecordSamples(records, start, end));
  });
});
