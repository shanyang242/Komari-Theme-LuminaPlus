import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "@/services/api";
import {
  getStoreStatusSnapshot,
  resolveTrafficTotal,
  retainStore,
} from "@/services/wsStore";

// 像 resolveTrafficTotals 每个 tick 那样,把一串原始累计读数喂给 resolver:把上一个显示值
//(store 存在 node metrics 上)往后传。
function drive(readings: number[]): number[] {
  let previous = 0;
  return readings.map((raw) => {
    previous = resolveTrafficTotal(previous, raw);
    return previous;
  });
}

describe("resolveTrafficTotal", () => {
  it("passes the backend counter through unchanged while it climbs", () => {
    expect(drive([10, 20, 30])).toEqual([10, 20, 30]);
  });

  it("holds the previous value when a tick reports zero (missing/partial sample)", () => {
    expect(drive([50, 0, 51])).toEqual([50, 50, 51]);
  });

  it("stays stable across repeated zero readings", () => {
    expect(drive([50, 0, 0, 51, 0, 52])).toEqual([50, 50, 50, 51, 51, 52]);
  });

  it("follows a genuine counter reset down (reboot / billing-cycle rollover)", () => {
    expect(drive([50, 5, 6])).toEqual([50, 5, 6]);
  });

  it("ignores a zero gap but still follows a later real reset", () => {
    expect(drive([50, 0, 2, 3])).toEqual([50, 50, 2, 3]);
  });

  it("does not surface a value until a real reading arrives", () => {
    expect(drive([0, 0, 10])).toEqual([0, 0, 10]);
  });
});

describe("wsStore hydration lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("window", {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
      setInterval: globalThis.setInterval.bind(globalThis),
      clearInterval: globalThis.clearInterval.bind(globalThis),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("keeps hydrated=true across stopStore even when the node list is legitimately empty (regression)", async () => {
    vi.spyOn(api, "getNodes").mockResolvedValue([]);
    vi.spyOn(api, "getNodesLatestStatus").mockResolvedValue({});

    const release = retainStore();
    await Promise.resolve();
    await Promise.resolve();
    expect(getStoreStatusSnapshot().hydrated).toBe(true);

    // 模拟切往后台管理页释放订阅，触发 stopTimer -> stopStore()
    release();
    await vi.advanceTimersByTimeAsync(1);
    expect(getStoreStatusSnapshot().hydrated).toBe(true);
  });
});
