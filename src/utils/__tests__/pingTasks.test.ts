import { describe, expect, it } from "vitest";
import type { PingTask } from "@/types/komari";
import {
  migrateLegacyHomepagePingBindings,
  normalizeHomepagePingNodeTaskIds,
  resolveHomepagePingTaskId,
  sortHomepagePingTasks,
} from "@/utils/pingTasks";

function task(id: number, weight: number, clients: string[] = []): PingTask {
  return {
    id,
    weight,
    clients,
    name: `Task ${id}`,
    interval: 60,
    loss: 0,
    type: "icmp",
    target: "",
  };
}

describe("homepage single-ping selection", () => {
  it("normalizes manual and explicit-unbound node overrides", () => {
    expect(normalizeHomepagePingNodeTaskIds({
      " node-b ": null,
      "node-a": "7",
      "node-c": 0,
      "": 3,
    })).toEqual({ "node-a": 7, "node-b": null });
  });

  it("migrates legacy task-to-node bindings with the lowest task id winning", () => {
    expect(migrateLegacyHomepagePingBindings({
      "9": ["node-a"],
      "2": ["node-a", "node-b"],
    })).toEqual({ "node-a": 2, "node-b": 2 });
  });

  it("orders tasks by Komari weight and then id", () => {
    expect(sortHomepagePingTasks([
      task(8, 20),
      task(4, 10),
      task(2, 10),
    ]).map((item) => item.id)).toEqual([2, 4, 8]);
  });

  it("preserves the backend order when the public API omits weights", () => {
    expect(sortHomepagePingTasks([
      task(8, 0),
      task(2, 0),
      task(4, 0),
    ]).map((item) => item.id)).toEqual([8, 2, 4]);
  });

  it("automatically selects the first backend-bound task by weight", () => {
    expect(resolveHomepagePingTaskId("node-a", [
      task(1, 30, ["node-a"]),
      task(9, 5, ["node-a"]),
      task(3, 10, ["node-a"]),
    ], {})).toBe(9);
  });

  it("honours manual and explicit-unbound overrides without backend validation", () => {
    const tasks = [task(1, 1, ["node-a"])];
    expect(resolveHomepagePingTaskId("node-a", tasks, { "node-a": 99 })).toBe(99);
    expect(resolveHomepagePingTaskId("node-a", tasks, { "node-a": null })).toBeNull();
  });

  it("falls back to actual records when an older backend omits task clients", () => {
    expect(resolveHomepagePingTaskId(
      "node-a",
      [task(7, 20), task(3, 5)],
      {},
      [
        { client: "node-a", task_id: 7 },
        { client: "node-a", task_id: 3 },
      ],
    )).toBe(3);
  });

  it("does not infer a binding from records when current backend bindings are known", () => {
    expect(resolveHomepagePingTaskId(
      "node-a",
      [task(3, 5)],
      {},
      [{ client: "node-a", task_id: 3 }],
      false,
    )).toBeNull();
  });
});
