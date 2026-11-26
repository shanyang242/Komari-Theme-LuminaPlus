import { describe, expect, it } from "vitest";
import {
  resolveFlatConnectionsTcp,
  resolveLatestNodeMetrics,
  resolveTrafficTotal,
} from "@/services/wsStore";
import { NodeInfoSchema, type NodeInfo, type NodeMetrics } from "@/types/komari";

const baseMeta: NodeInfo = NodeInfoSchema.parse({
  uuid: "node-1",
  name: "Tokyo Edge",
  mem_total: 8 * 1024 ** 3,
  swap_total: 2 * 1024 ** 3,
  disk_total: 160 * 1024 ** 3,
});

function createInitialMetrics(overrides: Partial<NodeMetrics> = {}): NodeMetrics {
  return {
    online: null,
    cpuPct: 0,
    ramUsed: 0,
    ramTotal: baseMeta.mem_total,
    ramPct: 0,
    swapUsed: 0,
    swapTotal: baseMeta.swap_total,
    diskUsed: 0,
    diskTotal: baseMeta.disk_total,
    diskPct: 0,
    netUp: 0,
    netDown: 0,
    trafficUp: 0,
    trafficDown: 0,
    uptime: 0,
    load1: 0,
    load5: 0,
    load15: 0,
    process: 0,
    connectionsTcp: 0,
    connectionsUdp: 0,
    updatedAt: 0,
    ...overrides,
  };
}

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
    // 读到 0 是 offline/heartbeat 帧或漏了 net_total_up/down 的 payload,不是真实流量。
    // 保持上一个值能避免闪烁到 0,也(这正是我们要防的回归)避免真实读数回来时重复抬高总量:
    // 概览以前每次 offline 抖动都会大致翻倍。
    expect(drive([50, 0, 51])).toEqual([50, 50, 51]);
  });

  it("stays stable across repeated zero readings", () => {
    expect(drive([50, 0, 0, 51, 0, 52])).toEqual([50, 50, 50, 51, 51, 52]);
  });

  it("follows a genuine counter reset down (reboot / billing-cycle rollover)", () => {
    // 后端计数器合理下降;我们如实透传,让概览和流量限额条跟随后端而不是停在虚高值。
    expect(drive([50, 5, 6])).toEqual([50, 5, 6]);
  });

  it("ignores a zero gap but still follows a later real reset", () => {
    // 50 → offline(0,保持)→ 重置后带一个小的真实计数回来。
    expect(drive([50, 0, 2, 3])).toEqual([50, 50, 2, 3]);
  });

  it("does not surface a value until a real reading arrives", () => {
    expect(drive([0, 0, 10])).toEqual([0, 0, 10]);
  });
});

describe("resolveFlatConnectionsTcp", () => {
  it("derives TCP as connections − udp (latest-status sends TCP+UDP combined)", () => {
    expect(resolveFlatConnectionsTcp({ connections: 12, connections_udp: 5 })).toBe(7);
  });

  it("prefers an explicit connections_tcp when present", () => {
    expect(
      resolveFlatConnectionsTcp({ connections: 12, connections_udp: 5, connections_tcp: 9 }),
    ).toBe(9);
  });

  it("clamps to 0 when udp exceeds the combined count", () => {
    expect(resolveFlatConnectionsTcp({ connections: 3, connections_udp: 5 })).toBe(0);
  });
});

describe("resolveLatestNodeMetrics", () => {
  const reportedAtIso = "2026-11-26T02:00:00.000Z";
  const reportedAtMs = Date.parse(reportedAtIso);

  const onlineMetrics = resolveLatestNodeMetrics(createInitialMetrics(), baseMeta, {
    online: true,
    cpu: 42.5,
    ram: 3 * 1024 ** 3,
    ram_total: 8 * 1024 ** 3,
    swap: 256 * 1024 ** 2,
    swap_total: 2 * 1024 ** 3,
    disk: 64 * 1024 ** 3,
    disk_total: 160 * 1024 ** 3,
    load: 1.4,
    load5: 1.1,
    load15: 0.9,
    net_out: 12_500_000,
    net_in: 38_000_000,
    net_total_up: 500 * 1024 ** 3,
    net_total_down: 900 * 1024 ** 3,
    uptime: 86_400 * 12,
    process: 134,
    connections: 96,
    connections_udp: 14,
    updated_at: reportedAtIso,
  });

  it("clears all live runtime metrics when backend returns an offline cached flat snapshot", () => {
    const offlineAtIso = "2026-11-26T02:05:00.000Z";
    const offline = resolveLatestNodeMetrics(onlineMetrics, baseMeta, {
      online: false,
      cpu: 42.5,
      ram: 3 * 1024 ** 3,
      ram_total: 8 * 1024 ** 3,
      swap: 256 * 1024 ** 2,
      swap_total: 2 * 1024 ** 3,
      disk: 64 * 1024 ** 3,
      disk_total: 160 * 1024 ** 3,
      load: 1.4,
      load5: 1.1,
      load15: 0.9,
      net_out: 12_500_000,
      net_in: 38_000_000,
      net_total_up: 510 * 1024 ** 3,
      net_total_down: 920 * 1024 ** 3,
      uptime: 86_400 * 12,
      process: 134,
      connections: 96,
      connections_udp: 14,
      updated_at: offlineAtIso,
    });

    expect(offline).toEqual({
      online: false,
      cpuPct: 0,
      ramUsed: 0,
      ramTotal: 8 * 1024 ** 3,
      ramPct: 0,
      swapUsed: 0,
      swapTotal: 2 * 1024 ** 3,
      diskUsed: 0,
      diskTotal: 160 * 1024 ** 3,
      diskPct: 0,
      netUp: 0,
      netDown: 0,
      trafficUp: 510 * 1024 ** 3,
      trafficDown: 920 * 1024 ** 3,
      uptime: 0,
      load1: 0,
      load5: 0,
      load15: 0,
      process: 0,
      connectionsTcp: 0,
      connectionsUdp: 0,
      updatedAt: Date.parse(offlineAtIso),
    });
  });

  it("clears live metrics on initial load when offline cached nested payload arrives", () => {
    const offline = resolveLatestNodeMetrics(createInitialMetrics(), baseMeta, {
      online: false,
      cpu: { usage: 66 },
      ram: { total: 8 * 1024 ** 3, used: 4 * 1024 ** 3 },
      swap: { total: 2 * 1024 ** 3, used: 512 * 1024 ** 2 },
      disk: { total: 160 * 1024 ** 3, used: 80 * 1024 ** 3 },
      load: { load1: 2.2, load5: 1.8, load15: 1.5 },
      network: {
        up: 5_000_000,
        down: 15_000_000,
        totalUp: 100 * 1024 ** 3,
        totalDown: 200 * 1024 ** 3,
      },
      connections: { tcp: 40, udp: 6 },
      uptime: 3600,
      process: 88,
      updated_at: reportedAtIso,
    });

    expect(offline.online).toBe(false);
    expect(offline.netUp).toBe(0);
    expect(offline.netDown).toBe(0);
    expect(offline.cpuPct).toBe(0);
    expect(offline.ramUsed).toBe(0);
    expect(offline.ramPct).toBe(0);
    expect(offline.diskUsed).toBe(0);
    expect(offline.diskPct).toBe(0);
    expect(offline.load1).toBe(0);
    expect(offline.uptime).toBe(0);
    expect(offline.connectionsTcp).toBe(0);
    expect(offline.connectionsUdp).toBe(0);
    expect(offline.process).toBe(0);
    expect(offline.trafficUp).toBe(100 * 1024 ** 3);
    expect(offline.trafficDown).toBe(200 * 1024 ** 3);
    expect(offline.updatedAt).toBe(reportedAtMs);
  });

  it("clears stale live metrics when an offline node is omitted or sends zeroed totals", () => {
    const omitted = resolveLatestNodeMetrics(onlineMetrics, baseMeta, undefined);
    expect(omitted.online).toBe(false);
    expect(omitted.netUp).toBe(0);
    expect(omitted.netDown).toBe(0);
    expect(omitted.cpuPct).toBe(0);
    expect(omitted.ramUsed).toBe(0);
    expect(omitted.diskUsed).toBe(0);
    expect(omitted.uptime).toBe(0);
    expect(omitted.connectionsTcp).toBe(0);
    expect(omitted.trafficUp).toBe(500 * 1024 ** 3);
    expect(omitted.trafficDown).toBe(900 * 1024 ** 3);
    expect(omitted.ramTotal).toBe(8 * 1024 ** 3);
    expect(omitted.updatedAt).toBe(reportedAtMs);

    const zeroTotals = resolveLatestNodeMetrics(onlineMetrics, baseMeta, {
      online: false,
      ram_total: 0,
      swap_total: 0,
      disk_total: 0,
      net_total_up: 0,
      net_total_down: 0,
    });
    expect(zeroTotals.ramTotal).toBe(8 * 1024 ** 3);
    expect(zeroTotals.swapTotal).toBe(2 * 1024 ** 3);
    expect(zeroTotals.diskTotal).toBe(160 * 1024 ** 3);
    expect(zeroTotals.trafficUp).toBe(500 * 1024 ** 3);
    expect(zeroTotals.trafficDown).toBe(900 * 1024 ** 3);
    expect(zeroTotals.updatedAt).toBe(reportedAtMs);
  });

  it("restores live metrics when a node recovers from offline to online", () => {
    const offline = resolveLatestNodeMetrics(onlineMetrics, baseMeta, undefined);
    const recoveredAtIso = "2026-11-26T02:10:00.000Z";
    const recovered = resolveLatestNodeMetrics(offline, baseMeta, {
      online: true,
      cpu: 18,
      ram: 1024 ** 3,
      ram_total: 8 * 1024 ** 3,
      disk: 40 * 1024 ** 3,
      disk_total: 160 * 1024 ** 3,
      net_out: 2_000_000,
      net_in: 4_000_000,
      net_total_up: 505 * 1024 ** 3,
      net_total_down: 910 * 1024 ** 3,
      uptime: 120,
      updated_at: recoveredAtIso,
    });

    expect(recovered.online).toBe(true);
    expect(recovered.cpuPct).toBe(18);
    expect(recovered.netUp).toBe(2_000_000);
    expect(recovered.netDown).toBe(4_000_000);
    expect(recovered.uptime).toBe(120);
    expect(recovered.trafficUp).toBe(505 * 1024 ** 3);
    expect(recovered.trafficDown).toBe(910 * 1024 ** 3);
    expect(recovered.updatedAt).toBe(Date.parse(recoveredAtIso));
  });
});
