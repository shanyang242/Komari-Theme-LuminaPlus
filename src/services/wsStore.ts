import type { NodeInfo, NodeMetrics, NodeRealtime, TrafficTrendSample } from "@/types/komari";
import { getNodes, getNodesLatestStatus } from "@/services/api";

type Listener = () => void;
type RealtimePayload = Record<string, unknown>;

interface State {
  metaByUuid: Record<string, NodeInfo>;
  metricsByUuid: Record<string, NodeMetrics>;
  trafficTrends: Record<string, NodeTrafficTrend>;
  order: string[];
  failureStreak: number;
}

export interface StoreStatusSnapshot {
  failureStreak: number;
}

export interface HomeNodeSummary {
  uuid: string;
  group: string;
  region: string;
  hidden: boolean;
  weight: number;
  online: boolean | null;
  trafficUp: number;
  trafficDown: number;
  netUp: number;
  netDown: number;
}

interface TrafficTrendSeries {
  buffer: TrafficTrendSample[];
  start: number;
  size: number;
  signature: string;
  snapshot: TrafficTrendSample[];
}

interface NodeTrafficTrend {
  up: TrafficTrendSeries;
  down: TrafficTrendSeries;
  snapshot: {
    up: TrafficTrendSample[];
    down: TrafficTrendSample[];
  };
}

const LIVE_STATUS_REFRESH_INTERVAL_MS = 2_000;
const NODE_INFO_REFRESH_INTERVAL_MS = 30_000;
// 实时轮询每 2s 一次;单次请求超时设得远低于 RPC 默认的 30s,这样 half-open socket 能
// 快速失败(暴露 failureStreak 并让下一 tick 重试),而不是冻结实时更新长达一分钟。
const LIVE_STATUS_REQUEST_TIMEOUT_MS = 8_000;
const SCROLL_IDLE_DELAY_MS = 160;
const TRAFFIC_TREND_SAMPLE_COUNT = 18;
const EMPTY_TRAFFIC_TREND_SAMPLE: TrafficTrendSample = {
  value: 0,
  level: 0.25,
  opacity: 0.52,
};
const EMPTY_TRAFFIC_TREND_SNAPSHOT = Array.from(
  { length: TRAFFIC_TREND_SAMPLE_COUNT },
  () => EMPTY_TRAFFIC_TREND_SAMPLE,
);
const EMPTY_TRAFFIC_TREND_SERIES: TrafficTrendSeries = {
  buffer: [],
  start: 0,
  size: 0,
  signature: "",
  snapshot: EMPTY_TRAFFIC_TREND_SNAPSHOT,
};
const EMPTY_NODE_TRAFFIC_TREND_SNAPSHOT = {
  up: EMPTY_TRAFFIC_TREND_SNAPSHOT,
  down: EMPTY_TRAFFIC_TREND_SNAPSHOT,
};
const EMPTY_TRAFFIC_TREND: NodeTrafficTrend = {
  up: EMPTY_TRAFFIC_TREND_SERIES,
  down: EMPTY_TRAFFIC_TREND_SERIES,
  snapshot: EMPTY_NODE_TRAFFIC_TREND_SNAPSHOT,
};

function emptyState(): State {
  return {
    metaByUuid: {},
    metricsByUuid: {},
    trafficTrends: {},
    order: [],
    failureStreak: 0,
  };
}

function emptyMetrics(info: NodeInfo, online: boolean | null): NodeMetrics {
  return {
    online,
    cpuPct: 0,
    ramUsed: 0,
    ramTotal: info.mem_total,
    ramPct: 0,
    swapUsed: 0,
    swapTotal: info.swap_total,
    swapPct: 0,
    diskUsed: 0,
    diskTotal: info.disk_total,
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
  };
}

function alignEmptyMetricsTotals(metrics: NodeMetrics, info: NodeInfo): NodeMetrics {
  if (metrics.updatedAt > 0) return metrics;
  if (
    metrics.ramTotal === info.mem_total &&
    metrics.swapTotal === info.swap_total &&
    metrics.diskTotal === info.disk_total
  ) {
    return metrics;
  }

  return {
    ...metrics,
    ramTotal: info.mem_total,
    swapTotal: info.swap_total,
    diskTotal: info.disk_total,
  };
}

// 直接透传节点累计流量计数(net_total_up/down)的某一方向 —— 包括计数器合理重置时的*下降*
//(agent 重装、计费周期翻转),让概览总量和每节点流量限额条始终对齐后端,而不是越飘越高。
// 唯一的保护:缺失总量的帧会被 normalize 成 0,所以把 0 当作"本 tick 无采样",保持上一个值,
// 避免局部实时帧把总量闪烁到 0。
//
// 这里有意替换掉之前基于 offset、为保持单调而在每次重置时携带旧总量的方案。那个方案会在每次
// offline→online 抖动时悄悄抬高显示总量(每抖一次就把整个节点总量再加一遍),一个会话下来远超
// 后端 —— 硬刷新时数值又跌回去然后再爬升。导出供单测使用。
export function resolveTrafficTotal(previous: number, raw: number): number {
  return Number.isFinite(raw) && raw > 0 ? raw : previous;
}

function resolveTrafficTotals(previous: NodeMetrics, nextUp: number, nextDown: number) {
  return {
    up: resolveTrafficTotal(previous.trafficUp, nextUp),
    down: resolveTrafficTotal(previous.trafficDown, nextDown),
  };
}

function mergeRealtime(
  metrics: NodeMetrics,
  rt: NodeRealtime,
  online: boolean,
): NodeMetrics {
  // normalizeRealtime 已保证 ram/swap/disk 的 total（缺值时回退 metrics/meta 的总量）为数值，
  // 故此处直接取用，无需再叠一层兜底。
  const ramUsed = rt.ram.used;
  const ramTotal = rt.ram.total;
  const swapUsed = rt.swap.used;
  const swapTotal = rt.swap.total;
  const diskUsed = rt.disk.used;
  const diskTotal = rt.disk.total;
  const updatedAt = toTimestamp(rt.updated_at);
  const trafficTotals = resolveTrafficTotals(
    metrics,
    rt.network?.totalUp ?? 0,
    rt.network?.totalDown ?? 0,
  );

  return {
    online,
    cpuPct: rt.cpu?.usage ?? 0,
    ramUsed,
    ramTotal,
    ramPct: ramTotal > 0 ? (ramUsed / ramTotal) * 100 : 0,
    swapUsed,
    swapTotal,
    swapPct: swapTotal > 0 ? (swapUsed / swapTotal) * 100 : 0,
    diskUsed,
    diskTotal,
    diskPct: diskTotal > 0 ? (diskUsed / diskTotal) * 100 : 0,
    netUp: rt.network?.up ?? 0,
    netDown: rt.network?.down ?? 0,
    trafficUp: trafficTotals.up,
    trafficDown: trafficTotals.down,
    uptime: rt.uptime ?? 0,
    load1: rt.load?.load1 ?? 0,
    load5: rt.load?.load5 ?? 0,
    load15: rt.load?.load15 ?? 0,
    process: rt.process ?? 0,
    connectionsTcp: rt.connections?.tcp ?? 0,
    connectionsUdp: rt.connections?.udp ?? 0,
    updatedAt: updatedAt > 0 ? updatedAt : metrics.updatedAt,
  };
}

function shallowEqualMetrics(a: NodeMetrics, b: NodeMetrics) {
  return (
    a.online === b.online &&
    a.cpuPct === b.cpuPct &&
    a.ramUsed === b.ramUsed &&
    a.ramTotal === b.ramTotal &&
    a.ramPct === b.ramPct &&
    a.swapUsed === b.swapUsed &&
    a.swapTotal === b.swapTotal &&
    a.swapPct === b.swapPct &&
    a.diskUsed === b.diskUsed &&
    a.diskTotal === b.diskTotal &&
    a.diskPct === b.diskPct &&
    a.netUp === b.netUp &&
    a.netDown === b.netDown &&
    a.trafficUp === b.trafficUp &&
    a.trafficDown === b.trafficDown &&
    a.uptime === b.uptime &&
    a.load1 === b.load1 &&
    a.load5 === b.load5 &&
    a.load15 === b.load15 &&
    a.process === b.process &&
    a.connectionsTcp === b.connectionsTcp &&
    a.connectionsUdp === b.connectionsUdp &&
    a.updatedAt === b.updatedAt
  );
}

function shallowEqualNodeInfo(a: NodeInfo, b: NodeInfo) {
  return (
    a.uuid === b.uuid &&
    a.name === b.name &&
    a.group === b.group &&
    a.region === b.region &&
    a.hidden === b.hidden &&
    a.ipv4 === b.ipv4 &&
    a.ipv6 === b.ipv6 &&
    a.cpu_name === b.cpu_name &&
    a.cpu_cores === b.cpu_cores &&
    a.arch === b.arch &&
    a.virtualization === b.virtualization &&
    a.os === b.os &&
    a.kernel_version === b.kernel_version &&
    a.gpu_name === b.gpu_name &&
    a.mem_total === b.mem_total &&
    a.swap_total === b.swap_total &&
    a.disk_total === b.disk_total &&
    a.weight === b.weight &&
    a.price === b.price &&
    a.billing_cycle === b.billing_cycle &&
    a.auto_renewal === b.auto_renewal &&
    a.currency === b.currency &&
    a.expired_at === b.expired_at &&
    a.tags === b.tags &&
    a.public_remark === b.public_remark &&
    a.traffic_limit === b.traffic_limit &&
    a.traffic_limit_type === b.traffic_limit_type &&
    a.created_at === b.created_at
    // 有意排除 `updated_at`:后端每次写记录(约 30s)都会更新它,但它并不展示,比较它会
    // 让每次 sync 都把所有节点标记为"变化"并重渲染整个 grid。
  );
}

function materializeTrafficTrendSnapshot(
  buffer: TrafficTrendSample[],
  start: number,
  size: number,
) {
  if (size <= 0) return EMPTY_TRAFFIC_TREND_SNAPSHOT;

  const snapshot = new Array<TrafficTrendSample>(TRAFFIC_TREND_SAMPLE_COUNT);
  const padding = TRAFFIC_TREND_SAMPLE_COUNT - size;

  for (let i = 0; i < padding; i++) {
    snapshot[i] = EMPTY_TRAFFIC_TREND_SAMPLE;
  }

  for (let i = 0; i < size; i++) {
    snapshot[padding + i] = buffer[(start + i) % TRAFFIC_TREND_SAMPLE_COUNT]!;
  }

  return snapshot;
}

function updateTrafficTrendSeries(
  prevSeries: TrafficTrendSeries,
  value: number,
  updatedAt: number,
  online: boolean | null,
) {
  if (online === false) {
    if (!prevSeries.signature && prevSeries.size === 0) {
      return { series: prevSeries, changed: false };
    }
    return { series: EMPTY_TRAFFIC_TREND_SERIES, changed: true };
  }

  const safeValue = Number.isFinite(value) && value > 0 ? value : 0;
  const signature = `${updatedAt || 0}:${safeValue}`;
  if (signature === prevSeries.signature) {
    return { series: prevSeries, changed: false };
  }

  let visibleMax = safeValue > 0 ? safeValue : 1;
  for (let i = 0; i < prevSeries.size; i++) {
    const sample = prevSeries.buffer[(prevSeries.start + i) % TRAFFIC_TREND_SAMPLE_COUNT];
    if (sample && sample.value > visibleMax) {
      visibleMax = sample.value;
    }
  }

  const level = safeValue > 0 ? Math.max(0.2, Math.min(1, safeValue / visibleMax)) : 0.25;
  const nextSample: TrafficTrendSample = {
    value: safeValue,
    level,
    opacity: safeValue > 0 ? 0.4 + level * 0.48 : 0.52,
  };

  const buffer =
    prevSeries.buffer.length === TRAFFIC_TREND_SAMPLE_COUNT
      ? prevSeries.buffer
      : new Array<TrafficTrendSample>(TRAFFIC_TREND_SAMPLE_COUNT);
  const nextSize =
    prevSeries.size < TRAFFIC_TREND_SAMPLE_COUNT
      ? prevSeries.size + 1
      : TRAFFIC_TREND_SAMPLE_COUNT;
  const nextStart =
    prevSeries.size < TRAFFIC_TREND_SAMPLE_COUNT
      ? prevSeries.start
      : (prevSeries.start + 1) % TRAFFIC_TREND_SAMPLE_COUNT;
  const insertIndex =
    prevSeries.size < TRAFFIC_TREND_SAMPLE_COUNT
      ? (prevSeries.start + prevSeries.size) % TRAFFIC_TREND_SAMPLE_COUNT
      : prevSeries.start;

  if (prevSeries.size > 0 && buffer !== prevSeries.buffer) {
    for (let i = 0; i < prevSeries.size; i++) {
      buffer[(prevSeries.start + i) % TRAFFIC_TREND_SAMPLE_COUNT] =
        prevSeries.buffer[(prevSeries.start + i) % TRAFFIC_TREND_SAMPLE_COUNT]!;
    }
  }
  buffer[insertIndex] = nextSample;

  return {
    series: {
      buffer,
      start: nextStart,
      size: nextSize,
      signature,
      snapshot: materializeTrafficTrendSnapshot(buffer, nextStart, nextSize),
    },
    changed: true,
  };
}

let state: State = emptyState();
const visibleNodeListeners = new Set<Listener>();
const allNodesListeners = new Set<Listener>();
const homeNodeSummaryListeners = new Set<Listener>();
const storeStatusListeners = new Set<Listener>();
const nodeMetaListeners = new Map<string, Set<Listener>>();
const nodeMetricsListeners = new Map<string, Set<Listener>>();
const trafficTrendListeners = new Map<string, Set<Listener>>();
let storeVersion = 0;
let visibleNodeUuidsSnapshot: string[] = [];
let visibleNodeUuidsSnapshotVersion = -1;
let visibleNodeUuidsWithHiddenSnapshot: string[] = [];
let visibleNodeUuidsWithHiddenSnapshotVersion = -1;
let allNodeMetaSnapshot: NodeInfo[] = [];
let allNodeMetaSnapshotVersion = -1;
let homeNodeSummariesSnapshot: HomeNodeSummary[] = [];
let homeNodeSummariesSnapshotVersion = -1;
let storeStatusSnapshot: StoreStatusSnapshot = { failureStreak: 0 };
let scrollIdleTimer: number | null = null;
let scrollTrackingStarted = false;
let scrollActive = false;
let refreshDeferredWhileScrolling = false;

interface CommitTouches {
  meta?: Iterable<string>;
  metrics?: Iterable<string>;
  trafficTrends?: Iterable<string>;
  nodeList?: boolean;
  allNodes?: boolean;
  storeStatus?: boolean;
}

function emitListeners(listeners: Iterable<Listener>) {
  for (const listener of listeners) listener();
}

function emitMappedListeners(
  listenersByKey: Map<string, Set<Listener>>,
  keys: Iterable<string>,
) {
  for (const key of keys) {
    const listeners = listenersByKey.get(key);
    if (listeners) emitListeners(listeners);
  }
}

function commit(next: State, touches: CommitTouches = {}) {
  state = next;
  // 每次 state 转换都自增。派生列表的 snapshot 用它做缓存 key,这样 getSnapshot(每次 React
  // 渲染都会调用)在上次调用后没有 commit 时能 O(1) 返回缓存引用。
  storeVersion += 1;
  const homeTouched = Boolean(
    touches.nodeList ||
      touches.allNodes ||
      touches.meta ||
      touches.metrics,
  );

  if (touches.nodeList) emitListeners(visibleNodeListeners);
  if (touches.allNodes) emitListeners(allNodesListeners);
  if (homeTouched) emitListeners(homeNodeSummaryListeners);
  if (touches.storeStatus) emitListeners(storeStatusListeners);
  if (touches.meta) {
    emitMappedListeners(nodeMetaListeners, touches.meta);
  }
  if (touches.metrics) {
    emitMappedListeners(nodeMetricsListeners, touches.metrics);
  }
  if (touches.trafficTrends) emitMappedListeners(trafficTrendListeners, touches.trafficTrends);
}

function markScrollActivity() {
  scrollActive = true;
  if (scrollIdleTimer != null) {
    window.clearTimeout(scrollIdleTimer);
  }
  scrollIdleTimer = window.setTimeout(() => {
    scrollIdleTimer = null;
    scrollActive = false;
    if (refreshDeferredWhileScrolling) {
      refreshDeferredWhileScrolling = false;
      void refreshLatestStatus();
    }
  }, SCROLL_IDLE_DELAY_MS);
}

function ensureScrollTrackingStarted() {
  if (scrollTrackingStarted) return;
  scrollTrackingStarted = true;
  window.addEventListener("scroll", markScrollActivity, { passive: true });
}

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function asRecord(value: unknown): RealtimePayload {
  return value && typeof value === "object" ? (value as RealtimePayload) : {};
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "" || normalized === "0" || normalized === "false") return false;
    if (normalized === "1" || normalized === "true") return true;
  }
  return fallback;
}

function resolveOnline(rawRecord: unknown): boolean {
  if (rawRecord == null) return false;
  if (typeof rawRecord === "boolean") return rawRecord;
  const record = asRecord(rawRecord);
  return asBoolean(record.online, Object.keys(record).length > 0);
}

function toTimestamp(value: string | number | undefined): number {
  if (typeof value === "number") {
    return value > 1_000_000_000_000 ? value : value * 1000;
  }
  if (!value) return 0;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric > 1_000_000_000_000 ? numeric : numeric * 1000;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

// 从扁平的 latest-status payload 推导 TCP 连接数。该协议把 `connections` 作为 TCP+UDP 合计
//(见 common.go)发送,没有 `connections_tcp`,所以直接把 `connections` 当 TCP 会让 "TCP 连接"
// 统计虚高一个 UDP 数。这里用 connections − udp 推导,未来后端若提供显式 `connections_tcp`
// 则优先用它。导出供单测使用。
export function resolveFlatConnectionsTcp(payload: RealtimePayload): number {
  if (payload.connections_tcp != null) return asNumber(payload.connections_tcp);
  return Math.max(0, asNumber(payload.connections) - asNumber(payload.connections_udp));
}

function normalizeRealtime(
  raw: unknown,
  meta: NodeInfo,
  metrics: NodeMetrics,
): NodeRealtime | null {
  const payload = asRecord(raw);
  if (Object.keys(payload).length === 0) return null;

  const cpu = asRecord(payload.cpu);
  const ram = asRecord(payload.ram);
  const swap = asRecord(payload.swap);
  const load = asRecord(payload.load);
  const disk = asRecord(payload.disk);
  const network = asRecord(payload.network);
  const connections = asRecord(payload.connections);
  const hasNestedShape =
    Object.keys(cpu).length > 0 ||
    Object.keys(ram).length > 0 ||
    Object.keys(network).length > 0;

  if (hasNestedShape) {
    return {
      cpu: { usage: asNumber(cpu.usage) },
      ram: {
        total: asNumber(ram.total, metrics.ramTotal || meta.mem_total),
        used: asNumber(ram.used),
      },
      swap: {
        total: asNumber(swap.total, metrics.swapTotal || meta.swap_total),
        used: asNumber(swap.used),
      },
      load: {
        load1: asNumber(load.load1),
        load5: asNumber(load.load5),
        load15: asNumber(load.load15),
      },
      disk: {
        total: asNumber(disk.total, metrics.diskTotal || meta.disk_total),
        used: asNumber(disk.used),
      },
      network: {
        up: asNumber(network.up),
        down: asNumber(network.down),
        totalUp: asNumber(network.totalUp),
        totalDown: asNumber(network.totalDown),
      },
      connections: {
        tcp: asNumber(connections.tcp),
        udp: asNumber(connections.udp),
      },
      uptime: asNumber(payload.uptime),
      process: asNumber(payload.process),
      updated_at: (payload.updated_at ?? payload.time) as string | number | undefined,
    };
  }

  return {
    cpu: { usage: asNumber(payload.cpu) },
    ram: {
      total: asNumber(payload.ram_total, metrics.ramTotal || meta.mem_total),
      used: asNumber(payload.ram),
    },
    swap: {
      total: asNumber(payload.swap_total, metrics.swapTotal || meta.swap_total),
      used: asNumber(payload.swap),
    },
    load: {
      load1: asNumber(payload.load),
      load5: asNumber(payload.load5),
      load15: asNumber(payload.load15),
    },
    disk: {
      total: asNumber(payload.disk_total, metrics.diskTotal || meta.disk_total),
      used: asNumber(payload.disk),
    },
    network: {
      up: asNumber(payload.net_out),
      down: asNumber(payload.net_in),
      totalUp: asNumber(payload.net_total_up),
      totalDown: asNumber(payload.net_total_down),
    },
    connections: {
      tcp: resolveFlatConnectionsTcp(payload),
      udp: asNumber(payload.connections_udp),
    },
    uptime: asNumber(payload.uptime),
    process: asNumber(payload.process),
    updated_at: (payload.updated_at ?? payload.time) as string | number | undefined,
  };
}

function applyLatestStatus(records: Record<string, unknown>) {
  const touchedMetrics = new Set<string>();
  const touchedTrafficTrends = new Set<string>();
  // 懒克隆 map —— 安静的 tick(metric/trend 无变化)很常见,且调用方会丢弃未变的 map,
  // 提前 spread 纯属浪费。syncNodeInfo 之后每个 order uuid 都已有 trend 条目,未变节点无需补齐。
  let nextMetricsByUuid = state.metricsByUuid;
  let nextTrafficTrends = state.trafficTrends;

  for (const uuid of state.order) {
    const meta = state.metaByUuid[uuid];
    const prev = state.metricsByUuid[uuid];
    if (!meta || !prev) continue;
    const rawRecord = records[uuid];
    const online = resolveOnline(rawRecord);
    const realtime = normalizeRealtime(rawRecord, meta, prev);
    const merged = realtime
      ? mergeRealtime(prev, realtime, online)
      : { ...prev, online };

    if (!shallowEqualMetrics(prev, merged)) {
      if (nextMetricsByUuid === state.metricsByUuid) {
        nextMetricsByUuid = { ...state.metricsByUuid };
      }
      nextMetricsByUuid[uuid] = merged;
      touchedMetrics.add(uuid);
    }

    const prevTrend = state.trafficTrends[uuid] ?? EMPTY_TRAFFIC_TREND;
    const nextUp = updateTrafficTrendSeries(
      prevTrend.up,
      merged.netUp,
      merged.updatedAt,
      merged.online,
    );
    const nextDown = updateTrafficTrendSeries(
      prevTrend.down,
      merged.netDown,
      merged.updatedAt,
      merged.online,
    );

    if (nextUp.changed || nextDown.changed) {
      if (nextTrafficTrends === state.trafficTrends) {
        nextTrafficTrends = { ...state.trafficTrends };
      }
      nextTrafficTrends[uuid] = {
        up: nextUp.series,
        down: nextDown.series,
        snapshot: {
          up: nextUp.series.snapshot,
          down: nextDown.series.snapshot,
        },
      };
      touchedTrafficTrends.add(uuid);
    }
  }

  return {
    nextMetricsByUuid,
    nextTrafficTrends,
    touchedMetrics: [...touchedMetrics],
    touchedTrafficTrends: [...touchedTrafficTrends],
  };
}

let hydrated = false;
let hydratePromise: Promise<void> | null = null;
let refreshInFlight = false;
let nodeInfoInFlight = false;
let lastNodeInfoSyncAt = 0;

function sortNodes(nodes: NodeInfo[]) {
  return nodes
    .map((node, index) => ({ node, index }))
    .sort((a, b) => {
      const byWeight = a.node.weight - b.node.weight;
      return byWeight === 0 ? a.index - b.index : byWeight;
    })
    .map(({ node }) => node);
}

async function syncNodeInfo(force = false) {
  if (nodeInfoInFlight) return;
  if (!force && hydrated && Date.now() - lastNodeInfoSyncAt < NODE_INFO_REFRESH_INTERVAL_MS) {
    return;
  }

  nodeInfoInFlight = true;
  try {
    const nodes = sortNodes(await getNodes());
    const order = nodes.map((node) => node.uuid);
    const touchedMeta = new Set<string>();
    const touchedMetrics = new Set<string>();
    const previousUuids = new Set(state.order);
    const nextUuids = new Set(order);
    const orderChanged =
      order.length !== state.order.length ||
      order.some((uuid, index) => uuid !== state.order[index]);
    const metaByUuid: Record<string, NodeInfo> = {};
    const metricsByUuid: Record<string, NodeMetrics> = {};

    for (const info of nodes) {
      const prev = state.metaByUuid[info.uuid];
      // 展示内容无变化时复用旧 meta 对象,保持引用稳定,让 useSyncExternalStore 不重渲染卡片。
      const isUnchanged = prev != null && shallowEqualNodeInfo(prev, info);
      // 有变化则克隆,给 meta 一个新引用(触发 useSyncExternalStore 重渲染);未变则复用 `prev`。
      const merged = isUnchanged ? prev : { ...info };
      metaByUuid[info.uuid] = merged;
      const previousMetrics = state.metricsByUuid[info.uuid];
      const nextMetrics = previousMetrics
        ? alignEmptyMetricsTotals(previousMetrics, info)
        : emptyMetrics(info, null);
      metricsByUuid[info.uuid] = nextMetrics;
      if (!isUnchanged) {
        touchedMeta.add(info.uuid);
      }
      if (!previousMetrics || previousMetrics !== nextMetrics) {
        touchedMetrics.add(info.uuid);
      }
    }

    for (const uuid of previousUuids) {
      if (!nextUuids.has(uuid)) {
        touchedMeta.add(uuid);
        touchedMetrics.add(uuid);
      }
    }

    const trafficTrends = Object.fromEntries(
      order.map((uuid) => [uuid, state.trafficTrends[uuid] ?? EMPTY_TRAFFIC_TREND]),
    );

    const nodeListChanged =
      orderChanged ||
      [...touchedMeta].some((uuid) => {
        const prev = state.metaByUuid[uuid];
        const next = metaByUuid[uuid];
        return Boolean(prev?.hidden) !== Boolean(next?.hidden);
      });

    hydrated = true;
    hydratePromise = Promise.resolve();
    lastNodeInfoSyncAt = Date.now();
    commit(
      {
        ...state,
        order,
        metaByUuid,
        metricsByUuid,
        trafficTrends,
      },
      {
        meta: touchedMeta,
        metrics: touchedMetrics,
        // traffic trend 只由 refreshLatestStatus 改动;syncNodeInfo 原样带过来,这里无需通知。
        nodeList: nodeListChanged,
        allNodes: orderChanged || touchedMeta.size > 0,
      },
    );
  } finally {
    nodeInfoInFlight = false;
  }
}

async function hydrate() {
  if (hydrated) return;
  if (hydratePromise) return hydratePromise;

  hydratePromise = syncNodeInfo(true).catch((error) => {
    hydratePromise = null;
    throw error;
  });

  return hydratePromise;
}

async function refreshLatestStatus() {
  if (refreshInFlight || state.order.length === 0) return;
  if (scrollActive) {
    refreshDeferredWhileScrolling = true;
    return;
  }

  refreshInFlight = true;
  try {
    const records = await getNodesLatestStatus([...state.order], {
      timeout: LIVE_STATUS_REQUEST_TIMEOUT_MS,
    });
    const applied = applyLatestStatus(records);
    const metricsChanged = applied.touchedMetrics.length > 0;
    const trafficTrendsChanged = applied.touchedTrafficTrends.length > 0;
    const storeStatusChanged = state.failureStreak > 0;

    if (metricsChanged || trafficTrendsChanged || storeStatusChanged) {
      commit(
        {
          ...state,
          metricsByUuid: metricsChanged ? applied.nextMetricsByUuid : state.metricsByUuid,
          trafficTrends:
            trafficTrendsChanged ? applied.nextTrafficTrends : state.trafficTrends,
          failureStreak: 0,
        },
        {
          metrics: applied.touchedMetrics,
          trafficTrends: applied.touchedTrafficTrends,
          storeStatus: storeStatusChanged,
        },
      );
    }
  } catch {
    commit(
      {
        ...state,
        failureStreak: state.failureStreak + 1,
      },
      { storeStatus: true },
    );
  } finally {
    refreshInFlight = false;
  }
}

async function bootstrap() {
  try {
    await hydrate();
    await refreshLatestStatus();
  } catch {
    // 下一个调度 tick 再重试。
  }
}

let started = false;
let liveStatusTimer: number | null = null;
let nodeInfoTimer: number | null = null;

export function ensureStarted() {
  if (started) return;
  started = true;

  ensureScrollTrackingStarted();
  void bootstrap();
  // 两条独立节奏:实时 metrics 每 2s,节点列表/meta sync 走自己的 30s 节奏。之前它们共用
  // 一条 await 链,跑慢速 /api/nodes 拉取的那个 tick 会拖住本周期的实时刷新。
  liveStatusTimer = window.setInterval(() => {
    // 首次 hydrate 成功前没有节点列表可轮询,所以按快节奏持续重试 bootstrap(沿用旧的单链
    // 行为);hydrate 完成后切到纯实时刷新。
    if (!hydrated) {
      void bootstrap();
      return;
    }
    void refreshLatestStatus();
  }, LIVE_STATUS_REFRESH_INTERVAL_MS);
  nodeInfoTimer = window.setInterval(() => {
    // syncNodeInfo 只有 finally;吞掉偶发的 /api/nodes 失败,避免失败的 30s tick 抛出
    // unhandled rejection(下一 tick 会重试)。
    void syncNodeInfo().catch(() => {});
  }, NODE_INFO_REFRESH_INTERVAL_MS);
}

export function stopStore() {
  if (liveStatusTimer != null) {
    window.clearInterval(liveStatusTimer);
    liveStatusTimer = null;
  }
  if (nodeInfoTimer != null) {
    window.clearInterval(nodeInfoTimer);
    nodeInfoTimer = null;
  }
  if (scrollIdleTimer != null) {
    window.clearTimeout(scrollIdleTimer);
    scrollIdleTimer = null;
  }
  if (scrollTrackingStarted) {
    window.removeEventListener("scroll", markScrollActivity);
    scrollTrackingStarted = false;
  }
  scrollActive = false;
  started = false;
}

function subscribeSet(listeners: Set<Listener>, listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function subscribeVisibleNodeUuids(listener: Listener): () => void {
  return subscribeSet(visibleNodeListeners, listener);
}

export function subscribeAllNodes(listener: Listener): () => void {
  return subscribeSet(allNodesListeners, listener);
}

export function subscribeHomeNodeSummaries(listener: Listener): () => void {
  return subscribeSet(homeNodeSummaryListeners, listener);
}

export function subscribeStoreStatus(listener: Listener): () => void {
  return subscribeSet(storeStatusListeners, listener);
}

export function subscribeToNodeMeta(uuid: string, listener: Listener): () => void {
  return subscribeByKey(nodeMetaListeners, uuid, listener);
}

export function subscribeToNodeMetrics(uuid: string, listener: Listener): () => void {
  return subscribeByKey(nodeMetricsListeners, uuid, listener);
}

export function subscribeToNodeTrafficTrend(uuid: string, listener: Listener): () => void {
  return subscribeByKey(trafficTrendListeners, uuid, listener);
}

function subscribeByKey(
  listenersByKey: Map<string, Set<Listener>>,
  key: string,
  listener: Listener,
): () => void {
  let listeners = listenersByKey.get(key);
  if (!listeners) {
    listeners = new Set();
    listenersByKey.set(key, listeners);
  }
  listeners.add(listener);

  return () => {
    listeners?.delete(listener);
    if (listeners && listeners.size === 0) {
      listenersByKey.delete(key);
    }
  };
}

export function getStoreStatusSnapshot(): StoreStatusSnapshot {
  if (storeStatusSnapshot.failureStreak === state.failureStreak) {
    return storeStatusSnapshot;
  }
  storeStatusSnapshot = { failureStreak: state.failureStreak };
  return storeStatusSnapshot;
}

export function getNodeMetaSnapshot(uuid: string): NodeInfo | undefined {
  return state.metaByUuid[uuid];
}

export function getNodeMetricsSnapshot(uuid: string): NodeMetrics | undefined {
  return state.metricsByUuid[uuid];
}

export function getNodeTrafficTrendSnapshot(uuid: string): {
  up: TrafficTrendSample[];
  down: TrafficTrendSample[];
} {
  const trend = state.trafficTrends[uuid] ?? EMPTY_TRAFFIC_TREND;
  return trend.snapshot;
}

export function getVisibleNodeUuidsSnapshot(includeHidden = false): string[] {
  if (includeHidden) {
    if (visibleNodeUuidsWithHiddenSnapshotVersion === storeVersion) {
      return visibleNodeUuidsWithHiddenSnapshot;
    }
  } else if (visibleNodeUuidsSnapshotVersion === storeVersion) {
    return visibleNodeUuidsSnapshot;
  }

  const next = state.order.filter((uuid) => {
    const node = state.metaByUuid[uuid];
    return Boolean(node) && (includeHidden || !node.hidden);
  });

  const previous = includeHidden
    ? visibleNodeUuidsWithHiddenSnapshot
    : visibleNodeUuidsSnapshot;
  const value =
    next.length === previous.length && next.every((uuid, index) => uuid === previous[index])
      ? previous
      : next;

  if (includeHidden) {
    visibleNodeUuidsWithHiddenSnapshot = value;
    visibleNodeUuidsWithHiddenSnapshotVersion = storeVersion;
  } else {
    visibleNodeUuidsSnapshot = value;
    visibleNodeUuidsSnapshotVersion = storeVersion;
  }
  return value;
}

export function getAllNodeMetaSnapshot(): NodeInfo[] {
  if (allNodeMetaSnapshotVersion === storeVersion) return allNodeMetaSnapshot;

  const next = state.order
    .map((uuid) => state.metaByUuid[uuid])
    .filter((node): node is NodeInfo => Boolean(node));

  if (
    !(
      next.length === allNodeMetaSnapshot.length &&
      next.every((node, index) => node === allNodeMetaSnapshot[index])
    )
  ) {
    allNodeMetaSnapshot = next;
  }
  allNodeMetaSnapshotVersion = storeVersion;
  return allNodeMetaSnapshot;
}

export function getHomeNodeSummariesSnapshot(): HomeNodeSummary[] {
  if (homeNodeSummariesSnapshotVersion === storeVersion) return homeNodeSummariesSnapshot;

  const next = state.order
    .map((uuid) => {
      const meta = state.metaByUuid[uuid];
      if (!meta) return null;
      const metrics = state.metricsByUuid[uuid];
      return {
        uuid,
        group: String(meta.group || "").trim(),
        region: String(meta.region || "").trim(),
        hidden: meta.hidden,
        weight: meta.weight,
        online: metrics?.online ?? null,
        trafficUp: metrics?.trafficUp ?? 0,
        trafficDown: metrics?.trafficDown ?? 0,
        netUp: metrics?.netUp ?? 0,
        netDown: metrics?.netDown ?? 0,
      };
    })
    .filter((item): item is HomeNodeSummary => Boolean(item));

  if (
    next.length === homeNodeSummariesSnapshot.length &&
    next.every((item, index) => {
      const prev = homeNodeSummariesSnapshot[index];
      return (
        prev &&
        prev.uuid === item.uuid &&
        prev.group === item.group &&
        prev.region === item.region &&
        prev.hidden === item.hidden &&
        prev.weight === item.weight &&
        prev.online === item.online &&
        prev.trafficUp === item.trafficUp &&
        prev.trafficDown === item.trafficDown &&
        prev.netUp === item.netUp &&
        prev.netDown === item.netDown
      );
    })
  ) {
    homeNodeSummariesSnapshotVersion = storeVersion;
    return homeNodeSummariesSnapshot;
  }

  homeNodeSummariesSnapshot = next;
  homeNodeSummariesSnapshotVersion = storeVersion;
  return homeNodeSummariesSnapshot;
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    stopStore();
  });
}
