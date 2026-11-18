import { afterEach, describe, expect, it, vi } from "vitest";
import * as api from "@/services/api";
import type { PingTask } from "@/types/komari";
import {
  buildPingBuckets,
  buildPingOverviewItems,
  buildPingOverviewMap,
  resetHomepagePingTasksCache,
} from "@/hooks/usePingOverview";

const MINUTE_MS = 60_000;
const NOW = Date.UTC(2026, 6, 17, 11, 2);

function task(
  id: number,
  weight: number,
  clients: string[],
  interval = 60,
): PingTask {
  return {
    id,
    weight,
    clients,
    interval,
    name: `Task ${id}`,
    loss: 0,
    type: "icmp",
    target: "example.com",
  };
}

afterEach(() => {
  resetHomepagePingTasksCache();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("homepage ping records", () => {
  it("groups raw records and keeps packet loss in the displayed buckets", () => {
    const items = buildPingOverviewItems(7, [
      { task_id: 7, time: NOW - 3 * MINUTE_MS, value: 42, client: "node-a" },
      { task_id: 7, time: NOW, value: -1, client: "node-a" },
    ]);
    const item = items.get("node-a")!;
    expect(item.loss).toBe(50);
    expect(item.lastValue).toBeNull();
    const buckets = buildPingBuckets(item, 24, NOW);
    expect(buckets).toHaveLength(24);
    expect(buckets.filter((bucket) => bucket.total > 0)).toHaveLength(2);
  });
});

describe("homepage single-ping polling selection", () => {
  it("fetches only the selected task_ids when a subset of tasks is displayed", async () => {
    const publicTasks = [
      task(9, 5, ["node-a"]),
      task(3, 10, ["node-b"]),
      task(1, 20, ["node-a"]),
    ];
    const load = vi.fn(async (_hours?: number, taskId?: number) => ({
      records:
        taskId === 9
          ? [{ task_id: 9, time: NOW, value: 9, client: "node-a" }]
          : taskId === 3
            ? [{ task_id: 3, time: NOW, value: 18, client: "node-b" }]
            : [{ task_id: 1, time: NOW, value: 30, client: "node-a" }],
      tasks: publicTasks,
    }));
    const loadTasks = vi.fn(async () => publicTasks);

    const result = await buildPingOverviewMap(
      1,
      ["node-a", "node-b"],
      {},
      undefined,
      load,
      loadTasks,
    );

    expect(loadTasks).toHaveBeenCalledOnce();
    expect(load).toHaveBeenCalledTimes(2);
    expect(load).toHaveBeenCalledWith(1, 3, expect.objectContaining({
      entityIds: ["node-a", "node-b"],
    }));
    expect(load).toHaveBeenCalledWith(1, 9, expect.objectContaining({
      entityIds: ["node-a", "node-b"],
    }));
    expect(result.selectedTaskIdsByClient).toEqual(new Map([
      ["node-a", 9],
      ["node-b", 3],
    ]));
    expect(result.singleItems.get("node-a")?.lastValue).toBe(9);
    expect(result.singleItems.get("node-b")?.lastValue).toBe(18);
  });

  it("passes task_id when all visible nodes share one default line", async () => {
    const publicTasks = [
      task(7, 1, ["node-a", "node-b"]),
      task(8, 2, ["node-a", "node-b"]),
    ];
    const load = vi.fn(async () => ({
      records: [
        { task_id: 7, time: NOW, value: 12, client: "node-a" },
        { task_id: 7, time: NOW, value: 22, client: "node-b" },
      ],
      tasks: publicTasks,
    }));

    const result = await buildPingOverviewMap(
      1,
      ["node-a", "node-b"],
      {},
      undefined,
      load,
      async () => publicTasks,
    );

    expect(load).toHaveBeenCalledOnce();
    expect(load).toHaveBeenCalledWith(1, 7, expect.objectContaining({
      entityIds: ["node-a", "node-b"],
    }));
    expect(result.singleItems.get("node-a")?.lastValue).toBe(12);
    expect(result.singleItems.get("node-b")?.lastValue).toBe(22);
  });

  it("uses a manual task even when the backend has not bound it to the node", async () => {
    const load = vi.fn(async () => ({ records: [], tasks: [task(1, 1, ["node-a"])] }));
    const result = await buildPingOverviewMap(
      1,
      ["node-a"],
      { "node-a": 99 },
      undefined,
      load,
      async () => [task(1, 1, ["node-a"])],
    );

    expect(load).toHaveBeenCalledWith(1, 99, expect.objectContaining({
      entityIds: ["node-a"],
    }));
    expect(result.selectedTaskIdsByClient.get("node-a")).toBe(99);
    expect(result.singleItems.get("node-a")).toMatchObject({
      isAssigned: true,
      lastValue: null,
      loadState: "ready",
    });
  });

  it("skips record fetching altogether when all visible nodes are unbound", async () => {
    const load = vi.fn(async () => ({
      records: [{ task_id: 1, time: NOW, value: 20, client: "node-a" }],
      tasks: [task(1, 1, ["node-a"])],
    }));

    const result = await buildPingOverviewMap(
      1,
      ["node-a"],
      { "node-a": null },
      undefined,
      load,
      async () => [task(1, 1, ["node-a"])],
    );

    expect(load).not.toHaveBeenCalled();
    expect(result.selectedTaskIdsByClient.has("node-a")).toBe(false);
    expect(result.singleItems.get("node-a")?.isAssigned).toBe(false);
  });

  it("does not treat historical records as a current binding when the public task list has no clients", async () => {
    const load = vi.fn(async () => ({
      records: [{ task_id: 3, time: NOW, value: 30, client: "node-a" }],
      tasks: [task(3, 5, [])],
    }));
    const result = await buildPingOverviewMap(
      1,
      ["node-a"],
      {},
      undefined,
      load,
      async () => [task(3, 5, [])],
    );

    expect(load).not.toHaveBeenCalled();
    expect(result.selectedTaskIdsByClient.has("node-a")).toBe(false);
    expect(result.singleItems.get("node-a")?.isAssigned).toBe(false);
  });

  it("caches public ping tasks across refreshes within the TTL window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const getTasksSpy = vi
      .spyOn(api, "getPublicPingTasks")
      .mockResolvedValue([task(5, 1, ["node-a"], 15)]);
    const load = vi.fn(async () => ({
      records: [{ task_id: 5, time: NOW, value: 16, client: "node-a" }],
      tasks: [task(5, 1, ["node-a"], 15)],
    }));

    await buildPingOverviewMap(1, ["node-a"], {}, undefined, load);
    vi.advanceTimersByTime(15_000);
    await buildPingOverviewMap(1, ["node-a"], {}, undefined, load);
    expect(getTasksSpy).toHaveBeenCalledTimes(1);

    // 超过 60s TTL 后自动重新拉取公开任务列表。
    vi.advanceTimersByTime(60_000);
    await buildPingOverviewMap(1, ["node-a"], {}, undefined, load);
    expect(getTasksSpy).toHaveBeenCalledTimes(2);
  });

  it("ignores a late task-list response from before cache reset so it cannot overwrite the newer line (regression)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);

    let resolveFirst!: (tasks: PingTask[]) => void;
    let resolveSecond!: (tasks: PingTask[]) => void;
    let firstSignal: AbortSignal | undefined;

    vi.spyOn(api, "getPublicPingTasks")
      .mockImplementationOnce((options) => {
        firstSignal = options?.signal;
        return new Promise<PingTask[]>((resolve) => {
          resolveFirst = resolve;
        });
      })
      .mockImplementationOnce(
        () =>
          new Promise<PingTask[]>((resolve) => {
            resolveSecond = resolve;
          }),
      );

    const load = vi.fn(async (_hours?: number, taskId?: number) => ({
      records: [{ task_id: taskId ?? 0, time: NOW, value: 20, client: "node-a" }],
      tasks: [],
    }));

    // 第 1 次进入首页发起请求，尚未返回即离开首页并清空任务缓存。
    const firstAbort = new AbortController();
    const firstPending = buildPingOverviewMap(1, ["node-a"], {}, firstAbort.signal, load);
    firstAbort.abort();
    resetHomepagePingTasksCache();
    expect(firstSignal?.aborted).toBe(true);
    await expect(firstPending).rejects.toThrow();

    // 立即返回首页：新请求先拿到线路 2，随后旧请求晚到返回线路 1。
    const secondPending = buildPingOverviewMap(1, ["node-a"], {}, undefined, load);
    resolveSecond([task(2, 1, ["node-a"], 15)]);
    const secondResult = await secondPending;
    expect(secondResult.selectedTaskIdsByClient.get("node-a")).toBe(2);

    resolveFirst([task(1, 1, ["node-a"], 15)]);
    await Promise.resolve();

    // 下一轮轮询命中缓存时必须保持线路 2，不能被晚到的旧响应切回线路 1。
    load.mockClear();
    vi.advanceTimersByTime(15_000);
    const nextResult = await buildPingOverviewMap(1, ["node-a"], {}, undefined, load);
    expect(nextResult.selectedTaskIdsByClient.get("node-a")).toBe(2);
    expect(load).toHaveBeenCalledWith(1, 2, expect.objectContaining({ entityIds: ["node-a"] }));
  });

  it("uses the selected tasks' shortest refresh interval", async () => {
    const result = await buildPingOverviewMap(
      1,
      ["node-a", "node-b"],
      {},
      undefined,
      async () => ({
        records: [],
        tasks: [task(1, 1, ["node-a"], 90), task(2, 2, ["node-b"], 15)],
      }),
      async () => [task(1, 1, ["node-a"], 90), task(2, 2, ["node-b"], 15)],
    );
    expect(result.intervalMs).toBe(15_000);
  });

  it("propagates cancellation to the overview request", async () => {
    const controller = new AbortController();
    let receivedSignal: AbortSignal | undefined;
    const pending = buildPingOverviewMap(
      1,
      ["node-a"],
      {},
      controller.signal,
      async (_hours, _taskId, options) => {
        receivedSignal = options?.signal;
        return await new Promise<never>((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          });
        });
      },
      async () => [task(1, 1, ["node-a"])],
    );
    await Promise.resolve();
    controller.abort();
    await expect(pending).rejects.toThrow("aborted");
    expect(receivedSignal?.aborted).toBe(true);
  });
});
