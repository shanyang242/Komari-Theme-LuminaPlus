import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcCallMock, MockRpcResponseError } = vi.hoisted(() => ({
  rpcCallMock: vi.fn(),
  MockRpcResponseError: class MockRpcResponseError extends Error {
    constructor(
      message: string,
      public readonly code?: number,
    ) {
      super(message);
    }
  },
}));

vi.mock("@/services/rpc2Client", () => ({
  getRpc2Client: () => ({ call: rpcCallMock }),
  RpcResponseError: MockRpcResponseError,
}));

import {
  getLoadRecords,
  getPingOverview,
  getPingOverviewStats,
  getPingRecords,
  getTodayTrafficMetrics,
} from "@/services/api";

const START = "2026-07-15T03:00:00Z";
const END = "2026-07-15T04:00:00Z";
const TAGS = { task_id: "7" };

function metricSeries(
  metricKey: string,
  points: Array<{ time: string; value: number | null; count?: number }>,
) {
  return {
    metric_key: metricKey,
    entity_id: "node-a",
    tags: TAGS,
    interval_seconds: 60,
    points,
  };
}

function aggregatePayload(hasGap: boolean) {
  const latency = hasGap
    ? [
        { time: "2026-07-15T03:43:00Z", value: 20, count: 1 },
        { time: "2026-07-15T03:44:00Z", value: null, count: 0 },
        { time: "2026-07-15T03:45:00Z", value: 30, count: 1 },
      ]
    : [
        { time: "2026-07-15T03:43:00Z", value: 20, count: 1 },
        { time: "2026-07-15T03:44:00Z", value: 25, count: 1 },
        { time: "2026-07-15T03:45:00Z", value: 30, count: 1 },
      ];
  const loss = latency.map((point) => ({
    ...point,
    value: point.count === 0 ? null : 0,
  }));
  return {
    start: START,
    end: END,
    series: [
      metricSeries("ping.latency_ms", latency),
      metricSeries("ping.loss", loss),
    ],
  };
}

function installRpcResponses({
  hasGap,
  rawFails = false,
  rawCount,
}: {
  hasGap: boolean;
  rawFails?: boolean;
  rawCount?: number;
}) {
  rpcCallMock.mockImplementation((method: string, params: Record<string, unknown>) => {
    if (method === "public:getPingMetricStats") {
      return Promise.resolve({
        stats: [
          {
            entity_id: "node-a",
            task_id: 7,
            name: "广州探测",
            interval: 60,
            total: hasGap ? 2 : 3,
            valid: hasGap ? 2 : 3,
            loss: 0,
            avg: 25,
            latest: 30,
          },
        ],
      });
    }
    if (method === "public:getPublicPingTasks") {
      return Promise.resolve([
        {
          id: 7,
          interval: 60,
          name: "广州探测",
          clients: ["node-a"],
        },
      ]);
    }
    if (method === "public:queryMetrics" && params.downsample === false) {
      if (rawFails) return Promise.reject(new Error("raw query failed"));
      return Promise.resolve({
        start: "2026-07-15T03:40:00Z",
        end: "2026-07-15T03:46:00Z",
        series: [
          metricSeries("ping.latency_ms", [
            {
              time: "2026-07-15T03:44:15Z",
              value: 50,
              ...(rawCount == null ? {} : { count: rawCount }),
            },
          ]),
          metricSeries("ping.loss", [
            {
              time: "2026-07-15T03:44:15Z",
              value: 0,
              ...(rawCount == null ? {} : { count: rawCount }),
            },
          ]),
        ],
      });
    }
    if (method === "public:queryMetrics") {
      return Promise.resolve(aggregatePayload(hasGap));
    }
    return Promise.reject(new Error(`Unexpected RPC method: ${method}`));
  });
}

function metricDataCalls() {
  return rpcCallMock.mock.calls.filter(
    ([method, params]) =>
      method === "public:queryMetrics" &&
      Array.isArray((params as Record<string, unknown>)?.metric_keys) &&
      ((params as Record<string, unknown>).metric_keys as unknown[]).length > 0,
  );
}

describe("metric boundary repair in the API adapter", () => {
  beforeEach(() => {
    rpcCallMock.mockReset();
  });

  it("does not request raw data when the aggregate boundary is continuous", async () => {
    installRpcResponses({ hasGap: false });
    const result = await getPingOverview(1, 7, { entityIds: ["node-a"] });

    expect(result.records).toHaveLength(3);
    const metricCalls = metricDataCalls();
    expect(metricCalls).toHaveLength(1);
  });

  it("keeps explicit task metadata when the selected client has no samples", async () => {
    rpcCallMock.mockImplementation((method: string) => {
      if (method === "public:getPingMetricStats") {
        return Promise.resolve({ stats: [] });
      }
      if (method === "public:getPublicPingTasks") {
        return Promise.resolve([
          {
            id: 7,
            interval: 60,
            name: "广州探测",
            clients: ["node-a"],
          },
        ]);
      }
      if (method === "public:queryMetrics") {
        return Promise.resolve({ start: START, end: END, series: [] });
      }
      return Promise.reject(new Error(`Unexpected RPC method: ${method}`));
    });

    const result = await getPingOverview(1, 7, { entityIds: ["node-b"] });

    expect(result.records).toEqual([]);
    expect(result.tasks).toEqual([
      expect.objectContaining({ id: 7, name: "广州探测", clients: ["node-a"] }),
    ]);
    expect(result.taskAssignmentsKnown).toBe(true);
  });

  it("requests only the bounded raw window and fills the empty bucket", async () => {
    installRpcResponses({ hasGap: true });
    const result = await getPingOverview(1, 7, { entityIds: ["node-a"] });

    expect(result.records).toHaveLength(3);
    expect(result.records.find((record) => record.time === "2026-07-15T03:44:00Z"))
      .toMatchObject({ value: 50, count: 1, loss: 0 });
    expect(result.stats?.[0]).toMatchObject({ total: 3, valid: 3, loss: 0 });

    const metricCalls = metricDataCalls();
    expect(metricCalls).toHaveLength(2);
    expect(metricCalls[1][1]).toMatchObject({
      entity_ids: ["node-a"],
      tags: TAGS,
      downsample: false,
      start: "2026-07-15T03:40:00.000Z",
      end: "2026-07-15T03:46:00.000Z",
    });
  });

  it("keeps the aggregate result when the optional raw repair fails", async () => {
    installRpcResponses({ hasGap: true, rawFails: true });
    const result = await getPingOverview(1, 7, { entityIds: ["node-a"] });

    expect(result.records).toHaveLength(2);
    expect(result.records.map((record) => record.time)).not.toContain(
      "2026-07-15T03:44:00Z",
    );
  });

  it("preserves hybrid rollup counts without requesting a backend version", async () => {
    installRpcResponses({ hasGap: true, rawCount: 4 });
    const result = await getPingOverview(1, 7, { entityIds: ["node-a"] });

    expect(result.records.find((record) => record.time === "2026-07-15T03:44:00Z"))
      .toMatchObject({ value: 50, count: 4, loss: 0 });
    expect(rpcCallMock.mock.calls.some(([method]) => method === "public:getVersion")).toBe(false);
  });

  it("fetches stats in the same call chain on the ping detail path, without boundary repair", async () => {
    installRpcResponses({ hasGap: true });

    const result = await getPingRecords("node-a", 24);

    expect(result.records).toHaveLength(2);
    expect(result.stats).toHaveLength(1);
    expect(result.stats?.[0]).toMatchObject({ total: 2, valid: 2 });
    const metricCalls = metricDataCalls();
    expect(metricCalls).toHaveLength(1);
    expect(metricCalls[0][1]).toMatchObject({
      entity_ids: ["node-a"],
      fill_empty: false,
    });
    expect(rpcCallMock).toHaveBeenCalledWith(
      "public:getPingMetricStats",
      expect.objectContaining({ entity_ids: ["node-a"], hours: 24 }),
      expect.anything(),
    );
  });

  it("batches homepage Ping statistics by task id", async () => {
    rpcCallMock.mockImplementation((method: string) => {
      if (method === "public:queryMetrics") {
        return Promise.reject(new MockRpcResponseError("metric_keys is required", -32602));
      }
      if (method === "public:getPingMetricStats") {
        return Promise.resolve({ stats: [] });
      }
      return Promise.reject(new Error(`Unexpected RPC method: ${method}`));
    });

    await getPingOverviewStats(1, [9, 7, 9], {
      entityIds: ["node-a", "node-b"],
    });

    const statsCalls = rpcCallMock.mock.calls.filter(
      ([method]) => method === "public:getPingMetricStats",
    );
    expect(statsCalls).toHaveLength(1);
    expect(rpcCallMock).toHaveBeenCalledWith(
      "public:getPingMetricStats",
      expect.objectContaining({
        hours: 1,
        task_ids: [7, 9],
        entity_ids: ["node-a", "node-b"],
      }),
      expect.anything(),
    );
  });

  it("skips the metric probe when the traffic compatibility path already failed it", async () => {
    rpcCallMock.mockResolvedValue({ count: 0, records: [] });

    const result = await getLoadRecords("node-a", 24, {
      skipMetricQuery: true,
      timeout: 8_000,
    });

    expect(result.records).toEqual([]);
    expect(rpcCallMock).toHaveBeenCalledTimes(1);
    expect(metricDataCalls()).toHaveLength(0);
    expect(rpcCallMock).toHaveBeenCalledWith(
      "common:getRecords",
      expect.objectContaining({ uuid: "node-a", hours: 24, type: "load" }),
      { signal: undefined, timeout: 8_000 },
    );
  });

  it("does not send removed Komari 1.3.0 total metrics in load queries", async () => {
    rpcCallMock.mockImplementation(() => {
      return Promise.resolve({
        start: START,
        end: END,
        series: [
          metricSeries("memory.used", [
            { time: "2026-07-15T03:30:00Z", value: 512, count: 1 },
          ]),
        ],
      });
    });

    const result = await getLoadRecords("node-a", 1);

    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({ client: "node-a", ram: 512 });
    expect(metricDataCalls()).toHaveLength(1);
    expect(rpcCallMock).toHaveBeenCalledWith(
      "public:queryMetrics",
      expect.objectContaining({
        entity_ids: ["node-a"],
        metric_keys: expect.not.arrayContaining([
          "memory.total",
          "swap.total",
          "disk.total",
        ]),
      }),
      expect.anything(),
    );
  });

  it("uses a small point budget for traffic totals while preserving rate chart detail", async () => {
    rpcCallMock.mockResolvedValue({ start: START, end: END, series: [] });

    await getTodayTrafficMetrics(
      ["node-a"],
      Date.parse("2026-07-15T00:00:00Z"),
      Date.parse("2026-07-15T12:00:00Z"),
    );

    expect(rpcCallMock).toHaveBeenCalledWith(
      "public:queryMetrics",
      expect.objectContaining({
        max_points: 144,
        max_points_by_metric: {
          "traffic.up": 12,
          "traffic.down": 12,
          "net.out.rate": 144,
          "net.in.rate": 144,
        },
      }),
      expect.anything(),
    );
  });
});
