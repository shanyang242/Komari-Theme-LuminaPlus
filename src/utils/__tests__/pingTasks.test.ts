import { describe, expect, it } from "vitest";
import type { PingTask } from "@/types/komari";
import {
  normalizeHomepagePingNodeTaskIds,
  resolveHomepagePingTaskId,
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

  it("automatically selects the first backend-bound task", () => {
    expect(resolveHomepagePingTaskId("node-a", [
      task(1, 30, ["node-a"]),
      task(9, 5, ["node-a"]),
      task(3, 10, ["node-a"]),
    ], {})).toBe(1);
  });

  it("honours manual and explicit-unbound overrides without backend validation", () => {
    const tasks = [task(1, 1, ["node-a"])];
    expect(resolveHomepagePingTaskId("node-a", tasks, { "node-a": 99 })).toBe(99);
    expect(resolveHomepagePingTaskId("node-a", tasks, { "node-a": null })).toBeNull();
  });
});
