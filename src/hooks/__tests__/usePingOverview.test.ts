import { describe, expect, it, vi } from "vitest";
import {
  buildPingOverviewMap,
  buildPingBuckets,
  buildPingOverviewItems,
  resolveHomepagePingRequestMode,
  selectPersistablePingOverview,
} from "@/hooks/usePingOverview";

const MINUTE_MS = 60_000;
const NOW = Date.UTC(2026, 6, 17, 11, 2);
const WINDOW_START = NOW - 60 * MINUTE_MS;

function aggregateSamples(intervalMinutes: number) {
  const alignedStart = Date.UTC(2026, 6, 17, 10, 0);
  const count = Math.ceil((NOW - alignedStart) / (intervalMinutes * MINUTE_MS));
  return Array.from({ length: count }, (_, index) => ({
    time: alignedStart + index * intervalMinutes * MINUTE_MS,
    value: 40 + index,
    count: intervalMinutes,
    loss: 0,
  }));
}

describe("homepage ping metric interval adaptation", () => {
  it("propagates the metric API interval into the homepage item", () => {
    const items = buildPingOverviewItems(
      7,
      [
        {
          task_id: 7,
          time: "2026-07-17T10:00:00Z",
          value: 42,
          client: "node-a",
          count: 5,
          loss: 0,
        },
      ],
      [],
      300,
    );

    expect(items.get("node-a")?.metricIntervalMs).toBe(5 * MINUTE_MS);
  });

  it("projects 1.2.7 five-minute aggregates across twenty-four continuous buckets", () => {
    const buckets = buildPingBuckets(
      {
        metricIntervalMs: 5 * MINUTE_MS,
        samples: aggregateSamples(5),
      },
      24,
      NOW,
    );

    expect(buckets).toHaveLength(24);
    expect(buckets.every((bucket) => bucket.total > 0 && bucket.value != null)).toBe(true);
    expect(buckets[0]?.startAt).toBe(WINDOW_START);
    expect(buckets[23]?.endAt).toBe(NOW);
  });

  it("removes the compact-card two-on one-off artifact without hiding a real gap", () => {
    const samples = aggregateSamples(5).filter(
      (sample) => sample.time !== Date.UTC(2026, 6, 17, 10, 30),
    );
    const buckets = buildPingBuckets(
      { metricIntervalMs: 5 * MINUTE_MS, samples },
      18,
      NOW,
    );

    expect(buckets).toHaveLength(18);
    expect(buckets.filter((bucket) => bucket.total === 0)).toHaveLength(2);
  });

  it("keeps 1.2.6 two-minute aggregates at the existing 24-bucket density", () => {
    const buckets = buildPingBuckets(
      {
        metricIntervalMs: 2 * MINUTE_MS,
        samples: Array.from({ length: 31 }, (_, index) => ({
          time: WINDOW_START + index * 2 * MINUTE_MS,
          value: 30,
          count: 2,
          loss: 0,
        })),
      },
      24,
      NOW,
    );

    expect(buckets).toHaveLength(24);
    expect(buckets.every((bucket) => bucket.total > 0)).toBe(true);
  });

  it("preserves the legacy fixed bucket count when interval metadata is absent", () => {
    const buckets = buildPingBuckets(
      {
        samples: [{ time: NOW - MINUTE_MS, value: 25 }],
      },
      18,
      NOW,
    );

    expect(buckets).toHaveLength(18);
    expect(buckets.filter((bucket) => bucket.total > 0)).toHaveLength(1);
  });
});

function pingOverviewResponse(taskId: number, value: number) {
  return {
    records: [
      {
        task_id: taskId,
        time: NOW,
        value,
        client: "node-a",
        count: 1,
        loss: 0,
      },
    ],
    tasks: [
      {
        id: taskId,
        interval: 60,
        name: `Task ${taskId}`,
        loss: 0,
        clients: ["node-a"],
        type: "icmp",
        target: "example.com",
        weight: taskId,
      },
    ],
    stats: [],
    intervalSeconds: 60,
  };
}

describe("homepage ping polling selection", () => {
  it("reports only the nodes affected by each completed task", async () => {
    const progress: Array<string[] | undefined> = [];
    const result = await buildPingOverviewMap(
      1,
      ["node-a", "node-b"],
      { 1: ["node-a"], 2: ["node-b"] },
      [],
      undefined,
      undefined,
      async (_hours, taskId) => {
        const response = pingOverviewResponse(taskId ?? 0, taskId ?? 0);
        const client = taskId === 1 ? "node-a" : "node-b";
        return {
          ...response,
          records: response.records.map((record) => ({ ...record, client })),
          tasks: response.tasks.map((task) => ({ ...task, clients: [client] })),
        };
      },
      undefined,
      (next) => progress.push(next.changedUuids),
    );

    expect(progress[0]).toEqual(["node-a", "node-b"]);
    expect(progress).toContainEqual(["node-a"]);
    expect(progress).toContainEqual(["node-b"]);
    expect(result.singleItems.get("node-a")?.lastValue).toBe(1);
    expect(result.singleItems.get("node-b")?.lastValue).toBe(2);
  });

  it("keeps large/compact and mini/list in their shared request modes", () => {
    expect(resolveHomepagePingRequestMode("large", true, [1, 2, 3])).toBe("multi");
    expect(resolveHomepagePingRequestMode("compact", true, [1, 2, 3])).toBe("multi");
    expect(resolveHomepagePingRequestMode("mini", true, [1, 2, 3])).toBe("single");
    expect(resolveHomepagePingRequestMode("list", true, [1, 2, 3])).toBe("single");
    expect(resolveHomepagePingRequestMode("large", false, [1, 2, 3])).toBe("single");
    expect(resolveHomepagePingRequestMode("large", true, [1, 2])).toBe("single");
    expect(
      resolveHomepagePingRequestMode("large", true, [], { "node-a": [1, 2, 3] }),
    ).toBe("multi");
  });

  it("dedupes per-node multi-ping tasks and filters each request to affected nodes", async () => {
    const loadOverview = vi.fn(
      async (
        _hours?: number,
        taskId?: number,
        options?: { entityIds?: string[] },
      ) => ({
        ...pingOverviewResponse(taskId ?? 0, taskId ?? 0),
        records: (options?.entityIds ?? []).map((client) => ({
          task_id: taskId ?? 0,
          time: NOW,
          value: taskId ?? 0,
          client,
          count: 1,
          loss: 0,
        })),
      }),
    );

    const result = await buildPingOverviewMap(
      1,
      ["node-a", "node-b"],
      {},
      [1, 2, 3],
      undefined,
      undefined,
      loadOverview as never,
      undefined,
      undefined,
      { "node-b": [2, 3, 4] },
    );

    expect(loadOverview).toHaveBeenCalledTimes(4);
    const callsByTask = new Map(
      loadOverview.mock.calls.map((call) => [call[1], call[2]?.entityIds]),
    );
    expect(callsByTask.get(1)).toEqual(["node-a"]);
    expect(callsByTask.get(2)).toEqual(["node-a", "node-b"]);
    expect(callsByTask.get(3)).toEqual(["node-a", "node-b"]);
    expect(callsByTask.get(4)).toEqual(["node-b"]);
    expect(result.multiLines.get("node-a")?.map((line) => line.taskId)).toEqual([1, 2, 3]);
    expect(result.multiLines.get("node-b")?.map((line) => line.taskId)).toEqual([2, 3, 4]);
  });

  it("distinguishes an unbound task from a bound task with no displayed sample", async () => {
    const result = await buildPingOverviewMap(
      1,
      ["node-a", "node-b"],
      {},
      [1, 2, 3],
      undefined,
      undefined,
      async (_hours, taskId) => pingOverviewResponse(taskId ?? 0, taskId ?? 0),
    );

    expect(result.multiLines.get("node-a")?.map((line) => line.isAssigned)).toEqual([
      true,
      true,
      true,
    ]);
    expect(result.multiLines.get("node-b")?.map((line) => line.isAssigned)).toEqual([
      false,
      false,
      false,
    ]);
    expect(result.multiLines.get("node-b")?.map((line) => line.taskName)).toEqual([
      "Task 1",
      "Task 2",
      "Task 3",
    ]);
  });

  it("lets an authoritative client list override retained historical samples", async () => {
    const result = await buildPingOverviewMap(
      1,
      ["node-a"],
      {},
      [1, 2, 3],
      undefined,
      undefined,
      async (_hours, taskId) => ({
        ...pingOverviewResponse(taskId ?? 0, taskId ?? 0),
        tasks: [
          {
            ...pingOverviewResponse(taskId ?? 0, taskId ?? 0).tasks[0],
            clients: [],
          },
        ],
        taskAssignmentsKnown: true,
      }),
    );

    expect(result.multiLines.get("node-a")?.map((line) => line.isAssigned)).toEqual([
      false,
      false,
      false,
    ]);
    expect(result.multiLines.get("node-a")?.map((line) => line.lastValue)).toEqual([
      null,
      null,
      null,
    ]);
    expect(result.multiLines.get("node-a")?.map((line) => line.samples)).toEqual([
      [],
      [],
      [],
    ]);
  });

  it("retains the previous line when one multi-ping task fails", async () => {
    const first = await buildPingOverviewMap(
      1,
      ["node-a"],
      {},
      [1, 2, 3],
      undefined,
      undefined,
      async (_hours, taskId) => pingOverviewResponse(taskId ?? 0, (taskId ?? 0) * 10),
    );

    const second = await buildPingOverviewMap(
      1,
      ["node-a"],
      {},
      [1, 2, 3],
      undefined,
      first,
      async (_hours, taskId) => {
        if (taskId === 2) throw new Error("temporary task failure");
        return pingOverviewResponse(taskId ?? 0, (taskId ?? 0) * 10 + 100);
      },
    );

    expect(first.multiLines.get("node-a")?.map((line) => line.lastValue)).toEqual([
      10,
      20,
      30,
    ]);
    expect(second.multiLines.get("node-a")?.map((line) => line.lastValue)).toEqual([
      110,
      20,
      130,
    ]);
    expect(second.multiLines.get("node-a")?.map((line) => line.loadState)).toEqual([
      "ready",
      "error",
      "ready",
    ]);
    expect(second.multiLines.get("node-a")?.[1]?.taskName).toBe("Task 2");
  });

  it("reports all failed tasks and refuses to persist an empty placeholder result", async () => {
    const progress: string[][] = [];
    const result = await buildPingOverviewMap(
      1,
      ["node-a"],
      { 8: ["node-a"] },
      [],
      undefined,
      undefined,
      async () => {
        throw new Error("temporary task failure");
      },
      undefined,
      (next) => {
        progress.push([next.pendingTaskIds.join(","), next.failedTaskIds.join(",")]);
      },
    );

    expect(result.successfulTaskIds).toEqual([]);
    expect(result.failedTaskIds).toEqual([8]);
    expect(result.pendingTaskIds).toEqual([]);
    expect(result.singleItems.get("node-a")).toMatchObject({ loadState: "error" });
    expect(progress).toContainEqual(["", "8"]);
    expect(selectPersistablePingOverview(result)).toBeNull();
  });

  it("persists only ready lines after a partial task failure", async () => {
    const result = await buildPingOverviewMap(
      1,
      ["node-a"],
      {},
      [1, 2, 3],
      undefined,
      undefined,
      async (_hours, taskId) => pingOverviewResponse(taskId ?? 0, taskId ?? 0),
    );
    const partial = await buildPingOverviewMap(
      1,
      ["node-a"],
      {},
      [1, 2, 3],
      undefined,
      result,
      async (_hours, taskId) => {
        if (taskId === 2) throw new Error("temporary task failure");
        return pingOverviewResponse(taskId ?? 0, (taskId ?? 0) + 100);
      },
    );

    const persisted = selectPersistablePingOverview(partial);
    const persistedLines = persisted?.multiLines.find(([uuid]) => uuid === "node-a")?.[1];
    expect(persistedLines?.map((line) => line.taskId)).toEqual([1, 3]);
    expect(persistedLines?.every((line) => line.loadState === "ready")).toBe(true);
  });

  it("keeps existing task data ready while a background refresh is pending", async () => {
    const previous = await buildPingOverviewMap(
      1,
      ["node-a"],
      {},
      [1, 2, 3],
      undefined,
      undefined,
      async (_hours, taskId) => pingOverviewResponse(taskId ?? 0, taskId ?? 0),
    );
    let releaseRefresh!: () => void;
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    const progress: Array<{ pending: number[]; states: Array<string | undefined> }> = [];

    const refresh = buildPingOverviewMap(
      1,
      ["node-a"],
      {},
      [1, 2, 3],
      undefined,
      previous,
      async (_hours, taskId) => {
        await refreshGate;
        return pingOverviewResponse(taskId ?? 0, (taskId ?? 0) + 100);
      },
      undefined,
      (next) => {
        progress.push({
          pending: next.pendingTaskIds,
          states: next.multiLines.get("node-a")?.map((line) => line.loadState) ?? [],
        });
      },
    );

    expect(progress[0]).toEqual({
      pending: [1, 2, 3],
      states: ["ready", "ready", "ready"],
    });
    releaseRefresh();
    await refresh;
  });

  it("emits a completed task before a slower task settles", async () => {
    let releaseSlowTask!: () => void;
    const slowTask = new Promise<void>((resolve) => {
      releaseSlowTask = resolve;
    });
    const progress: number[][] = [];
    const pending = buildPingOverviewMap(
      1,
      ["node-a"],
      {},
      [1, 2, 3],
      undefined,
      undefined,
      async (_hours, taskId) => {
        if (taskId === 2) await slowTask;
        return pingOverviewResponse(taskId ?? 0, (taskId ?? 0) * 10);
      },
      undefined,
      (result) => {
        progress.push(
          result.multiLines.get("node-a")?.map((line) => line.lastValue ?? -1) ?? [],
        );
      },
    );

    await vi.waitFor(() => {
      expect(progress.some((values) => values[0] === 10 && values[1] === -1)).toBe(true);
    });

    releaseSlowTask();
    const result = await pending;
    expect(result.multiLines.get("node-a")?.map((line) => line.lastValue)).toEqual([
      10,
      20,
      30,
    ]);
  });

  it("loads all selected task stats once and reuses them across task series", async () => {
    const loadOverview = vi.fn(
      async (
        _hours?: number,
        taskId?: number,
        _options?: {
          signal?: AbortSignal;
          entityIds?: string[];
          includeStats?: boolean;
        },
      ) => {
        void _hours;
        void _options;
        return pingOverviewResponse(taskId ?? 0, (taskId ?? 0) * 10);
      },
    );
    const loadStats = vi.fn(async (_hours: number, taskIds: number[]) =>
      taskIds.map((taskId) => ({
        client: "node-a",
        taskId,
        name: `Server Task ${taskId}`,
        type: "icmp",
        interval: 60,
        total: 10,
        valid: 10,
        loss: 0,
        min: 10,
        max: 200 + taskId,
        avg: 50,
        latest: 100 + taskId,
        p50: 40,
        p99: 80,
        stddev: 5,
        p99P50Ratio: 1,
      })),
    );

    const result = await buildPingOverviewMap(
      1,
      ["node-a"],
      {},
      [1, 2, 3],
      undefined,
      undefined,
      loadOverview,
      loadStats,
    );

    expect(loadStats).toHaveBeenCalledTimes(1);
    expect(loadStats).toHaveBeenCalledWith(
      1,
      [1, 2, 3],
      expect.objectContaining({ entityIds: ["node-a"] }),
    );
    expect(loadOverview).toHaveBeenCalledTimes(3);
    expect(loadOverview.mock.calls.every((call) => call[2]?.includeStats === false)).toBe(true);
    expect(result.multiLines.get("node-a")?.map((line) => line.lastValue)).toEqual([
      101,
      102,
      103,
    ]);
  });

  it("propagates polling cancellation to an in-flight request", async () => {
    const controller = new AbortController();
    let requestSignal: AbortSignal | undefined;
    const pending = buildPingOverviewMap(
      1,
      ["node-a"],
      { 8: ["node-a"] },
      [],
      controller.signal,
      undefined,
      async (_hours, taskId, options) => {
        requestSignal = options?.signal;
        await new Promise<void>((_resolve, reject) => {
          options?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        });
        return pingOverviewResponse(taskId ?? 0, 80);
      },
    );

    await Promise.resolve();
    controller.abort();
    const result = await pending;

    expect(requestSignal?.aborted).toBe(true);
    expect(result.singleItems.get("node-a")?.lastValue).toBeNull();
  });
});
