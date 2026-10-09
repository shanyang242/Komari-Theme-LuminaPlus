import { describe, expect, it, vi } from "vitest";
import type { PingTask } from "@/types/komari";
import {
  buildPingBuckets,
  buildPingOverviewItems,
  buildPingOverviewMap,
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
  it("loads all tasks once and automatically selects each node's first binding", async () => {
    const publicTasks = [
      task(9, 5, ["node-a"]),
      task(3, 10, ["node-b"]),
      task(1, 20, ["node-a"]),
    ];
    const load = vi.fn(async () => ({
      records: [
        { task_id: 1, time: NOW, value: 30, client: "node-a" },
        { task_id: 9, time: NOW, value: 9, client: "node-a" },
        { task_id: 3, time: NOW, value: 18, client: "node-b" },
      ],
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

    expect(load).toHaveBeenCalledWith(1, undefined, expect.objectContaining({
      entityIds: ["node-a", "node-b"],
    }));
    expect(loadTasks).toHaveBeenCalledOnce();
    expect(result.selectedTaskIdsByClient).toEqual(new Map([
      ["node-a", 9],
      ["node-b", 3],
    ]));
    expect(result.singleItems.get("node-a")?.lastValue).toBe(9);
    expect(result.singleItems.get("node-b")?.lastValue).toBe(18);
  });

  it("uses a manual task even when the backend has not bound it to the node", async () => {
    const result = await buildPingOverviewMap(
      1,
      ["node-a"],
      { "node-a": 99 },
      undefined,
      async () => ({ records: [], tasks: [task(1, 1, ["node-a"])] }),
      async () => [task(1, 1, ["node-a"])],
    );

    expect(result.selectedTaskIdsByClient.get("node-a")).toBe(99);
    expect(result.singleItems.get("node-a")).toMatchObject({
      isAssigned: true,
      lastValue: null,
      loadState: "ready",
    });
  });

  it("keeps an explicit unbound selection unassigned for fake-ping fallback", async () => {
    const result = await buildPingOverviewMap(
      1,
      ["node-a"],
      { "node-a": null },
      undefined,
      async () => ({
        records: [{ task_id: 1, time: NOW, value: 20, client: "node-a" }],
        tasks: [task(1, 1, ["node-a"])],
      }),
      async () => [task(1, 1, ["node-a"])],
    );

    expect(result.selectedTaskIdsByClient.has("node-a")).toBe(false);
    expect(result.singleItems.get("node-a")?.isAssigned).toBe(false);
  });

  it("does not treat historical records as a current binding when the public task list is available", async () => {
    const result = await buildPingOverviewMap(
      1,
      ["node-a"],
      {},
      undefined,
      async () => ({
        records: [{ task_id: 3, time: NOW, value: 30, client: "node-a" }],
        tasks: [task(3, 5, [])],
      }),
      async () => [task(3, 5, [])],
    );

    expect(result.selectedTaskIdsByClient.has("node-a")).toBe(false);
    expect(result.singleItems.get("node-a")?.isAssigned).toBe(false);
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

  it("propagates cancellation to the single overview request", async () => {
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
      async () => [],
    );
    controller.abort();
    await expect(pending).rejects.toThrow("aborted");
    expect(receivedSignal?.aborted).toBe(true);
  });
});
