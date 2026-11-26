import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NodeInfoSchema, type NodeInfo } from "@/types/komari";

const { getNodesMock, getNodesLatestStatusMock } = vi.hoisted(() => ({
  getNodesMock: vi.fn(),
  getNodesLatestStatusMock: vi.fn(),
}));

vi.mock("@/services/api", () => ({
  getNodes: getNodesMock,
  getNodesLatestStatus: getNodesLatestStatusMock,
}));

import {
  getAllNodeMetaSnapshot,
  getStoreHydrationSnapshot,
  getStoreStatusSnapshot,
  retainStore,
  subscribeStoreHydration,
  subscribeStoreStatus,
} from "@/services/wsStore";

const sampleNode: NodeInfo = NodeInfoSchema.parse({
  uuid: "node-1",
  name: "Tokyo Edge",
  mem_total: 8 * 1024 ** 3,
  swap_total: 0,
  disk_total: 160 * 1024 ** 3,
});

describe("wsStore lifecycle", () => {
  const originalWindow = globalThis.window;

  beforeEach(() => {
    vi.useFakeTimers();
    getNodesMock.mockReset();
    getNodesLatestStatusMock.mockReset();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        setTimeout: globalThis.setTimeout.bind(globalThis),
        clearTimeout: globalThis.clearTimeout.bind(globalThis),
        setInterval: globalThis.setInterval.bind(globalThis),
        clearInterval: globalThis.clearInterval.bind(globalThis),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });
  });

  afterEach(async () => {
    await vi.runOnlyPendingTimersAsync().catch(() => undefined);
    vi.useRealTimers();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
  });

  it("clears state and notifies hydration/status listeners on stopStore()", async () => {
    getNodesMock.mockResolvedValue([sampleNode]);
    getNodesLatestStatusMock.mockResolvedValue({ "node-1": { online: true, cpu: 10 } });

    const hydrationListener = vi.fn();
    const statusListener = vi.fn();
    const unsubHydration = subscribeStoreHydration(hydrationListener);
    const unsubStatus = subscribeStoreStatus(statusListener);

    const release = retainStore();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(getStoreHydrationSnapshot().hydrated).toBe(true);
    expect(getAllNodeMetaSnapshot()).toHaveLength(1);

    hydrationListener.mockClear();
    statusListener.mockClear();

    release();
    vi.advanceTimersByTime(1);

    expect(getStoreHydrationSnapshot()).toEqual({ hydrated: false, nodeInfoError: false });
    expect(getStoreStatusSnapshot()).toEqual({
      failureStreak: 0,
      hydrated: false,
      nodeInfoError: false,
    });
    expect(getAllNodeMetaSnapshot()).toEqual([]);
    expect(hydrationListener).toHaveBeenCalledTimes(1);
    expect(statusListener).toHaveBeenCalledTimes(1);

    unsubHydration();
    unsubStatus();
  });

  it("re-hydrates cleanly when retained again before an aborted sync settles", async () => {
    let resolveFirst!: (value: NodeInfo[]) => void;
    let firstAborted = false;
    getNodesMock
      .mockImplementationOnce(
        ({ signal }: { signal?: AbortSignal } = {}) =>
          new Promise<NodeInfo[]>((resolve) => {
            signal?.addEventListener("abort", () => {
              firstAborted = true;
            });
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce([sampleNode]);
    getNodesLatestStatusMock.mockResolvedValue({ "node-1": { online: true, cpu: 20 } });

    const release1 = retainStore();
    expect(getNodesMock).toHaveBeenCalledTimes(1);

    // 卸载触发 stopStore()，中止第一次 syncNodeInfo，但旧 Promise 尚未 settle
    release1();
    vi.advanceTimersByTime(1);
    expect(firstAborted).toBe(true);

    // 立即重新挂载：不得复用已中止的 nodeInfoPromise，应发起第二次 getNodes
    const release2 = retainStore();
    expect(getNodesMock).toHaveBeenCalledTimes(2);

    // 即使旧 Promise 在之后才 settle，也不得破坏第二次同步的水合结果
    resolveFirst([]);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(getStoreHydrationSnapshot().hydrated).toBe(true);
    expect(getAllNodeMetaSnapshot().map((node) => node.uuid)).toEqual(["node-1"]);

    release2();
    vi.advanceTimersByTime(1);
  });
});
