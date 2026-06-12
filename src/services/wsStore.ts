import type { NodeInfo, NodeMetrics, NodeRealtime, TrafficTrendSample } from "@/types/komari";
import { getNodes, getNodesLatestStatus } from "@/services/api";

type Listener = () => void;
type RealtimePayload = Record<string, unknown>;

interface State {
  metaByUuid: Record<string, NodeInfo>;
  metricsByUuid: Record<string, NodeMetrics>;
  trafficTrends: Record<string, NodeTrafficTrend>;
  order: string[];
  lastSuccessAt: number;
  failureStreak: number;
}

export interface StoreStatusSnapshot {
  failureStreak: number;
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
    lastSuccessAt: 0,
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

function mergeNodeInfo(info: NodeInfo): NodeInfo {
  return { ...info };
}

function mergeRealtime(
  meta: NodeInfo,
  metrics: NodeMetrics,
  rt: NodeRealtime,
  online: boolean,
): NodeMetrics {
  const ramUsed = rt.ram?.used ?? 0;
  const ramTotal = rt.ram?.total ?? metrics.ramTotal ?? meta.mem_total;
  const swapUsed = rt.swap?.used ?? 0;
  const swapTotal = rt.swap?.total ?? metrics.swapTotal ?? meta.swap_total;
  const diskUsed = rt.disk?.used ?? 0;
  const diskTotal = rt.disk?.total ?? metrics.diskTotal ?? meta.disk_total;
  const updatedAt = toTimestamp(rt.updated_at);

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
    trafficUp: rt.network?.totalUp ?? 0,
    trafficDown: rt.network?.totalDown ?? 0,
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
    // `updated_at` is intentionally excluded: the backend bumps it on every
    // record write (~every 30s) but it isn't displayed, so comparing it would
    // mark every node "changed" each sync and re-render the whole grid.
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
const storeStatusListeners = new Set<Listener>();
const nodeMetaListeners = new Map<string, Set<Listener>>();
const nodeMetricsListeners = new Map<string, Set<Listener>>();
const trafficTrendListeners = new Map<string, Set<Listener>>();
let visibleNodeUuidsSnapshot: string[] = [];
let allNodeMetaSnapshot: NodeInfo[] = [];
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

  if (touches.nodeList) emitListeners(visibleNodeListeners);
  if (touches.allNodes) emitListeners(allNodesListeners);
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
      tcp: asNumber(payload.connections),
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
  const nextMetricsByUuid: Record<string, NodeMetrics> = { ...state.metricsByUuid };
  const nextTrafficTrends: Record<string, NodeTrafficTrend> = { ...state.trafficTrends };

  for (const uuid of state.order) {
    const meta = state.metaByUuid[uuid];
    const prev = state.metricsByUuid[uuid];
    if (!meta || !prev) continue;
    const rawRecord = records[uuid];
    const online = resolveOnline(rawRecord);
    const realtime = normalizeRealtime(rawRecord, meta, prev);
    const merged = realtime
      ? mergeRealtime(meta, prev, realtime, online)
      : { ...prev, online };

    if (!shallowEqualMetrics(prev, merged)) {
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
      nextTrafficTrends[uuid] = {
        up: nextUp.series,
        down: nextDown.series,
        snapshot: {
          up: nextUp.series.snapshot,
          down: nextDown.series.snapshot,
        },
      };
      touchedTrafficTrends.add(uuid);
    } else if (!(uuid in nextTrafficTrends)) {
      nextTrafficTrends[uuid] = prevTrend;
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
      // Reuse the previous meta object when nothing displayed changed, so its
      // identity stays stable and useSyncExternalStore doesn't re-render the card.
      const isUnchanged = prev != null && shallowEqualNodeInfo(prev, info);
      const merged = isUnchanged ? prev : mergeNodeInfo(info);
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
        // Traffic trends are only mutated by refreshLatestStatus; syncNodeInfo
        // carries them over unchanged, so there's nothing to notify here.
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
    const records = await getNodesLatestStatus([...state.order]);
    const applied = applyLatestStatus(records);
    const metricsChanged = applied.touchedMetrics.length > 0;
    const trafficTrendsChanged = applied.touchedTrafficTrends.length > 0;
    const storeStatusChanged = state.failureStreak > 0 || state.lastSuccessAt === 0;

    if (metricsChanged || trafficTrendsChanged || storeStatusChanged) {
      commit(
        {
          ...state,
          metricsByUuid: metricsChanged ? applied.nextMetricsByUuid : state.metricsByUuid,
          trafficTrends:
            trafficTrendsChanged ? applied.nextTrafficTrends : state.trafficTrends,
          lastSuccessAt: Date.now(),
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
    await syncNodeInfo();
    await refreshLatestStatus();
  } catch {
    // Retry on the next scheduled tick.
  }
}

let started = false;
export function ensureStarted() {
  if (started) return;
  started = true;

  ensureScrollTrackingStarted();
  void bootstrap();
  window.setInterval(() => {
    void bootstrap();
  }, LIVE_STATUS_REFRESH_INTERVAL_MS);
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

export function getVisibleNodeUuidsSnapshot(): string[] {
  const next = state.order.filter((uuid) => {
    const node = state.metaByUuid[uuid];
    return Boolean(node) && !node.hidden;
  });

  if (
    next.length === visibleNodeUuidsSnapshot.length &&
    next.every((uuid, index) => uuid === visibleNodeUuidsSnapshot[index])
  ) {
    return visibleNodeUuidsSnapshot;
  }

  visibleNodeUuidsSnapshot = next;
  return visibleNodeUuidsSnapshot;
}

export function getAllNodeMetaSnapshot(): NodeInfo[] {
  const next = state.order
    .map((uuid) => state.metaByUuid[uuid])
    .filter((node): node is NodeInfo => Boolean(node));

  if (
    next.length === allNodeMetaSnapshot.length &&
    next.every((node, index) => node === allNodeMetaSnapshot[index])
  ) {
    return allNodeMetaSnapshot;
  }

  allNodeMetaSnapshot = next;
  return allNodeMetaSnapshot;
}
