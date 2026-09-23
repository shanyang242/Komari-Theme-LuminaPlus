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

describe("homepage ping records", () => {
  it("groups raw backend records into the displayed time buckets", () => {
    const items = buildPingOverviewItems(7, [
      { task_id: 7, time: NOW - 3 * MINUTE_MS, value: 42, client: "node-a" },
      { task_id: 7, time: NOW, value: -1, client: "node-a" },
    ]);
    const item = items.get("node-a");
    expect(item?.loss).toBe(50);
    const buckets = buildPingBuckets(item!, 24, NOW);
    expect(buckets).toHaveLength(24);
    expect(buckets.filter((bucket) => bucket.total > 0)).toHaveLength(2);
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
      (next) => progress.push(next.changedUuids),
    );

    expect(progress[0]).toEqual(["node-a", "node-b"]);
    expect(progress).toContainEqual(["node-a"]);
    expect(progress).toContainEqual(["node-b"]);
    expect(result.singleItems.get("node-a")?.lastValue).toBe(1);
    expect(result.singleItems.get("node-b")?.lastValue).toBe(2);
  });

  it("uses multi-ping when configured", () => {
    expect(resolveHomepagePingRequestMode(true, [1, 2, 3])).toBe("multi");
    expect(resolveHomepagePingRequestMode(false, [1, 2, 3])).toBe("single");
    expect(resolveHomepagePingRequestMode(true, [1, 2])).toBe("single");
    expect(
      resolveHomepagePingRequestMode(true, [], { "node-a": [1, 2, 3] }),
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
