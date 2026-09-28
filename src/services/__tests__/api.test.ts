import { beforeEach, describe, expect, it, vi } from "vitest";

const rpcCallMock = vi.hoisted(() => vi.fn());
vi.mock("@/services/rpc2Client", () => ({
  getRpc2Client: () => ({ call: rpcCallMock }),
}));

import {
  getLoadRecords,
  getNodes,
  getPingOverview,
  getPingRecords,
  getPublicPingTasks,
} from "@/services/api";

const pingTask = {
  id: 7, name: "探测", type: "icmp", interval: 60, clients: ["node-a"],
};
const pingRecord = { task_id: 7, time: "2026-07-15T03:00:00Z", value: 45, client: "node-a" };

beforeEach(() => rpcCallMock.mockReset());

describe("modified backend RPC2", () => {
  it("loads the public ping task order and bindings", async () => {
    rpcCallMock.mockResolvedValue([pingTask]);
    await expect(getPublicPingTasks()).resolves.toEqual([
      expect.objectContaining({ id: 7, clients: ["node-a"] }),
    ]);
    expect(rpcCallMock).toHaveBeenCalledWith(
      "public:getPublicPingTasks",
      {},
      undefined,
    );
  });

  it("loads nodes from common:getNodes", async () => {
    rpcCallMock.mockResolvedValue({ "node-a": { uuid: "node-a", name: "A", ipv4: "1.2.3.4" } });
    const nodes = await getNodes();
    expect(nodes[0]).toMatchObject({ uuid: "node-a", ipv4: "1.2.3.4" });
    expect(rpcCallMock).toHaveBeenCalledWith("common:getNodes", {}, undefined);
  });

  it("reads grouped load records through common:getRecords", async () => {
    rpcCallMock.mockResolvedValue({ count: 1, records: {
      "node-a": [{ time: "2026-07-15T03:00:00Z", client: "node-a", cpu: 33 }],
    } });
    const result = await getLoadRecords("node-a", 6);
    expect(result.records[0]).toMatchObject({ client: "node-a", cpu: 33 });
    expect(rpcCallMock).toHaveBeenCalledWith("common:getRecords", expect.objectContaining({
      uuid: "node-a", hours: 6, type: "load",
    }), undefined);
  });

  it("reads ping records and per-node statistics from the backend", async () => {
    rpcCallMock.mockImplementation(async (method: string) => method === "common:getRecords"
      ? { count: 1, records: [pingRecord], tasks: [pingTask] }
      : { stats: [{ entity_id: "node-a", task_id: "7", total: 1, valid: 1, loss: 0, avg: 45 }] });
    const result = await getPingRecords("node-a", 2);
    expect(result.records).toHaveLength(1);
    expect(result.stats?.[0]).toMatchObject({ client: "node-a", taskId: 7, avg: 45 });
    expect(rpcCallMock).toHaveBeenCalledWith("common:getRecords", {
      uuid: "node-a", hours: 2, type: "ping", maxCount: -1,
    }, undefined);
    expect(rpcCallMock).toHaveBeenCalledWith("public:getPingMetricStats", {
      entity_id: "node-a", hours: 2,
    }, undefined);
  });

  it("filters overview records to visible nodes while retaining task assignments", async () => {
    rpcCallMock.mockResolvedValue({ count: 2, records: [
      pingRecord, { ...pingRecord, client: "node-b" },
    ], tasks: [pingTask] });
    const result = await getPingOverview(1, 7, { entityIds: ["node-a"] });
    expect(result.records.map((record) => record.client)).toEqual(["node-a"]);
    expect(result.tasks[0].clients).toEqual(["node-a"]);
    expect(rpcCallMock).toHaveBeenCalledWith("common:getRecords", expect.objectContaining({
      type: "ping", task_id: 7,
    }), expect.anything());
  });
});
