import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useAllNodeMeta, useVisibleNodeUuids } from "@/hooks/useNode";
import { useThemeSettings } from "@/hooks/useThemeSettings";
import { getPingOverview } from "@/services/api";
import type { PingOverviewBucket, PingOverviewItem } from "@/types/komari";
import { signalWithTimeout } from "@/utils/abort";
import { collectMatchingNodeUuids } from "@/utils/nodeIdentity";
import {
  invertHomepagePingTaskBindings,
  type HomepagePingTaskBindings,
} from "@/utils/pingTasks";

const DEFAULT_PING_REFRESH_INTERVAL = 60_000;
const MIN_PING_REFRESH_INTERVAL = 10_000;
const MAX_PING_REFRESH_INTERVAL = 300_000;
// 首页 mini 图表特意固定为前端聚合的 24 个 bucket。首页卡片是用来快速看趋势的，
// 所以把最近一小时聚合成 24 等分窗口，而不是每根柱子对应一个后端原始 bucket。
const MAX_VISIBLE_HOMEPAGE_PING_BUCKETS = 24;

const EMPTY_PING: PingOverviewItem = {
  client: "",
  isAssigned: false,
  lastValue: null,
  values: [],
  samples: [],
  max: 1,
  loss: null,
};

interface PingOverviewMapResult {
  assignmentKey: string;
  intervalMs: number;
  items: Map<string, PingOverviewItem>;
}

type Listener = () => void;

function toTimestamp(value: string | number) {
  if (typeof value === "number") {
    return value > 1_000_000_000_000 ? value : value * 1000;
  }
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? 0 : parsed;
}

function normalizeRefreshInterval(seconds: number | null | undefined) {
  if (!Number.isFinite(seconds) || !seconds || seconds <= 0) {
    return DEFAULT_PING_REFRESH_INTERVAL;
  }

  return Math.min(
    MAX_PING_REFRESH_INTERVAL,
    Math.max(MIN_PING_REFRESH_INTERVAL, seconds * 1000),
  );
}

function normalizeVisibleUuids(uuids: string[]) {
  return Array.from(new Set(uuids.filter(Boolean))).sort((left, right) =>
    left.localeCompare(right),
  );
}

function stringifyBindings(bindings: HomepagePingTaskBindings) {
  return JSON.stringify(
    Object.entries(bindings)
      .map(([taskId, clients]) => [taskId, [...clients].sort((left, right) => left.localeCompare(right))])
      .sort(([left], [right]) => Number(left) - Number(right)),
  );
}

function equalNumberArray(a: number[], b: number[]) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function equalSamples(
  a: Array<{ time: number; value: number }>,
  b: Array<{ time: number; value: number }>,
) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i]?.time !== b[i]?.time || a[i]?.value !== b[i]?.value) return false;
  }
  return true;
}

function equalPingItem(a: PingOverviewItem | undefined, b: PingOverviewItem | undefined) {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.client === b.client &&
    a.isAssigned === b.isAssigned &&
    a.lastValue === b.lastValue &&
    a.max === b.max &&
    a.loss === b.loss &&
    equalNumberArray(a.values, b.values) &&
    equalSamples(a.samples, b.samples)
  );
}

function buildPingOverviewItems(
  taskId: number,
  records: Array<{ task_id: number; time: string | number; value: number; client: string }>,
) {
  const selectedRecords = records.filter((record) => record.task_id === taskId);
  const grouped = new Map<string, Array<(typeof selectedRecords)[number]>>();
  const lossStatsByClient = new Map<string, { total: number; lost: number }>();

  for (const record of selectedRecords) {
    if (!record.client) continue;
    const current = grouped.get(record.client);
    if (current) current.push(record);
    else grouped.set(record.client, [record]);

    const stats = lossStatsByClient.get(record.client) ?? { total: 0, lost: 0 };
    stats.total += 1;
    // 只有 value<0（-1）才是丢包；0 表示往返 <1ms 的成功探测，不能算丢。
    if (record.value < 0) {
      stats.lost += 1;
    }
    lossStatsByClient.set(record.client, stats);
  }

  const result = new Map<string, PingOverviewItem>();
  for (const [client, clientRecords] of grouped) {
    const sorted = [...clientRecords].sort(
      (left, right) => toTimestamp(left.time) - toTimestamp(right.time),
    );
    const latestRecord = sorted[sorted.length - 1];
    const values: number[] = new Array(sorted.length);
    const samples: Array<{ time: number; value: number }> = [];
    let max = 1;

    for (let i = 0; i < sorted.length; i++) {
      const record = sorted[i];
      const value = record.value;
      const time = toTimestamp(record.time);
      values[i] = value;
      if (time > 0) {
        samples.push({ time, value });
      }
      if (value > max) {
        max = value;
      }
    }

    const lossStats = lossStatsByClient.get(client);
    result.set(client, {
      client,
      isAssigned: true,
      lastValue: latestRecord && latestRecord.value >= 0 ? latestRecord.value : null,
      values,
      samples,
      max,
      loss: lossStats?.total ? (lossStats.lost / lossStats.total) * 100 : null,
    });
  }

  return result;
}

function resolveSelectedTasks(
  clientUuids: string[],
  bindings: HomepagePingTaskBindings,
) {
  const selectedTaskByClient = new Map<string, number>();
  const bindingSelection = invertHomepagePingTaskBindings(bindings);

  for (const uuid of clientUuids) {
    const taskId = bindingSelection.get(uuid);
    if (taskId != null) {
      selectedTaskByClient.set(uuid, taskId);
    }
  }

  return selectedTaskByClient;
}

function buildAssignmentKey(selectedTaskByClient: Map<string, number>) {
  return Array.from(selectedTaskByClient.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([uuid, taskId]) => `${uuid}:${taskId}`)
    .join("|");
}

// 单次 overview 请求的硬上限。RPC 传输自带 ~30s 限制，但 HTTP fallback（`apiGet`）
// 没有超时——没有这个保护，一旦 fallback fetch 卡死就永远不结束，`pingRefreshInFlight`
// 会一直为 true，把后续所有轮询都卡死。给每个请求加 race 才能保证整条链路能恢复。
const PING_REQUEST_TIMEOUT_MS = 35_000;

async function buildOverviewMap(
  hours: number,
  clientUuids: string[],
  bindings: HomepagePingTaskBindings,
  signal?: AbortSignal,
): Promise<PingOverviewMapResult> {
  const normalizedUuids = normalizeVisibleUuids(clientUuids);
  if (normalizedUuids.length === 0) {
    return {
      assignmentKey: "",
      intervalMs: DEFAULT_PING_REFRESH_INTERVAL,
      items: new Map<string, PingOverviewItem>(),
    };
  }

  const selectedTaskByClient = resolveSelectedTasks(normalizedUuids, bindings);
  const selectedTaskIds = Array.from(new Set(selectedTaskByClient.values())).sort(
    (left, right) => left - right,
  );

  if (selectedTaskIds.length === 0) {
    return {
      assignmentKey: "",
      intervalMs: DEFAULT_PING_REFRESH_INTERVAL,
      items: new Map<string, PingOverviewItem>(),
    };
  }

  const overviewResults = await Promise.allSettled(
    selectedTaskIds.map(async (taskId) => {
      const requestSignal = signalWithTimeout(signal, PING_REQUEST_TIMEOUT_MS);
      return {
        taskId,
        overview: await getPingOverview(hours, taskId, { signal: requestSignal }),
      };
    }),
  );

  const itemsByTask = new Map<number, Map<string, PingOverviewItem>>();
  const refreshIntervals: number[] = [];

  for (const result of overviewResults) {
    if (result.status !== "fulfilled") {
      continue;
    }

    const {
      taskId,
      overview: { records, tasks },
    } = result.value;
    itemsByTask.set(taskId, buildPingOverviewItems(taskId, records));

    const taskInterval = tasks.find((task) => task.id === taskId)?.interval;
    refreshIntervals.push(normalizeRefreshInterval(taskInterval));
  }

  const items = new Map<string, PingOverviewItem>();
  for (const [uuid, taskId] of selectedTaskByClient) {
    const item = itemsByTask.get(taskId)?.get(uuid);
    if (item) {
      items.set(uuid, item);
      continue;
    }
    items.set(uuid, {
      client: uuid,
      isAssigned: true,
      lastValue: null,
      values: [],
      samples: [],
      max: 1,
      loss: null,
    });
  }

  return {
    assignmentKey: buildAssignmentKey(selectedTaskByClient),
    intervalMs:
      refreshIntervals.length > 0
        ? Math.min(...refreshIntervals)
        : DEFAULT_PING_REFRESH_INTERVAL,
    items,
  };
}

interface PingOverviewStoreState {
  assignmentKey: string;
  intervalMs: number;
  items: Map<string, PingOverviewItem>;
}

let pingOverviewState: PingOverviewStoreState = {
  assignmentKey: "",
  intervalMs: DEFAULT_PING_REFRESH_INTERVAL,
  items: new Map(),
};
let scheduledVisibleUuids: string[] = [];
let scheduledVisibleKey = "";
let scheduledBindings: HomepagePingTaskBindings = {};
let scheduledBindingsKey = stringifyBindings({});
let pingRefreshInFlight = false;
let pingRefreshTimer: number | null = null;
let pingAbortController: AbortController | null = null;
let activeConsumers = 0;
const pingListeners = new Map<string, Set<Listener>>();

function schedulePingRefresh(intervalMs: number) {
  if (pingRefreshTimer != null) {
    window.clearTimeout(pingRefreshTimer);
    pingRefreshTimer = null;
  }
  // 没有组件消费 overview 时就停止轮询。等有消费者再次挂载时，
  // 由 ensurePingOverviewStarted 重新启动整条链路。
  if (activeConsumers <= 0) return;
  pingRefreshTimer = window.setTimeout(() => {
    pingRefreshTimer = null;
    void refreshPingOverview();
  }, intervalMs);
}

function stopPingPolling() {
  if (pingRefreshTimer != null) {
    window.clearTimeout(pingRefreshTimer);
    pingRefreshTimer = null;
  }
  // 中止进行中的 refresh（如果有），让它的请求和带宽在 teardown 时立刻释放；
  // refreshPingOverview 会把已 abort 的 signal 当成非当前，跳过 commit/重新调度。
  if (pingAbortController) {
    pingAbortController.abort();
    pingAbortController = null;
  }
}

function commitPingOverview(
  assignmentKey: string,
  intervalMs: number,
  items: Map<string, PingOverviewItem>,
) {
  const prevItems = pingOverviewState.items;
  const nextItems = new Map<string, PingOverviewItem>();
  const touched = new Set<string>();
  const keys = new Set<string>([...prevItems.keys(), ...items.keys()]);

  for (const key of keys) {
    const prev = prevItems.get(key);
    const next = items.get(key);

    if (!next) {
      // buildOverviewMap 对每个被选中的 client 都会产出占位项，所以一个 key 缺失只可能是该
      // client 离开了选择集（assignmentKey 必然随之改变）。直接丢弃旧条目并通知订阅者。
      if (prev) touched.add(key);
      continue;
    }

    if (equalPingItem(prev, next)) {
      nextItems.set(key, prev ?? next);
      continue;
    }

    nextItems.set(key, next);
    touched.add(key);
  }

  if (
    pingOverviewState.assignmentKey === assignmentKey &&
    pingOverviewState.intervalMs === intervalMs &&
    touched.size === 0 &&
    nextItems.size === prevItems.size
  ) {
    return;
  }

  pingOverviewState = {
    assignmentKey,
    intervalMs,
    items: nextItems,
  };

  for (const key of touched) {
    const listeners = pingListeners.get(key);
    if (!listeners) continue;
    for (const listener of listeners) listener();
  }
}

async function refreshPingOverview() {
  if (pingRefreshInFlight) return;

  pingRefreshInFlight = true;
  const visibleKey = scheduledVisibleKey;
  const bindingsKey = scheduledBindingsKey;
  const controller = new AbortController();
  pingAbortController = controller;
  const { signal } = controller;
  // 判断当前请求是否仍然有效（没被 stopPingPolling 中止，
  // 且 visible/binding 分配在执行期间没有被改掉）。
  const isCurrent = () =>
    !signal.aborted &&
    visibleKey === scheduledVisibleKey &&
    bindingsKey === scheduledBindingsKey;

  try {
    if (scheduledVisibleUuids.length === 0) {
      commitPingOverview("", DEFAULT_PING_REFRESH_INTERVAL, new Map());
      return;
    }

    const next = await buildOverviewMap(
      1,
      scheduledVisibleUuids,
      scheduledBindings,
      signal,
    );
    if (isCurrent()) {
      commitPingOverview(next.assignmentKey, next.intervalMs, next.items);
      schedulePingRefresh(next.intervalMs);
    }
  } catch {
    if (isCurrent()) {
      schedulePingRefresh(DEFAULT_PING_REFRESH_INTERVAL);
    }
  } finally {
    pingRefreshInFlight = false;
    if (pingAbortController === controller) pingAbortController = null;
    // 只要消费者还想轮询但队列里没有任务，就恢复轮询。这覆盖了执行中途 assignment
    // 变化（上面那次跑会跳过 commit）以及 abort/重新挂载竞态（如 StrictMode:
    // mount→stop(abort)→mount），后者里被 abort 的那次不能负责重新调度。成功或失败
    // 的一次已经设过 timer，所以稳态下这里是 no-op。
    if (
      activeConsumers > 0 &&
      scheduledVisibleUuids.length > 0 &&
      pingRefreshTimer == null
    ) {
      void refreshPingOverview();
    }
  }
}

function ensurePingOverviewStarted(
  visibleUuids: string[],
  bindings: HomepagePingTaskBindings,
) {
  const normalizedVisibleUuids = normalizeVisibleUuids(visibleUuids);
  const visibleKey = normalizedVisibleUuids.join("|");
  const bindingsKey = stringifyBindings(bindings);

  if (
    scheduledVisibleKey !== visibleKey ||
    scheduledBindingsKey !== bindingsKey
  ) {
    scheduledVisibleUuids = normalizedVisibleUuids;
    scheduledVisibleKey = visibleKey;
    scheduledBindings = bindings;
    scheduledBindingsKey = bindingsKey;

    if (pingRefreshTimer != null) {
      window.clearTimeout(pingRefreshTimer);
      pingRefreshTimer = null;
    }
    void refreshPingOverview();
    return;
  }

  // 只要没有待处理请求、也没有已调度的 tick 就重启——这同时覆盖首次挂载
  // 和轮询被停止后的恢复。
  if (
    normalizedVisibleUuids.length > 0 &&
    !pingRefreshInFlight &&
    pingRefreshTimer == null
  ) {
    void refreshPingOverview();
  }
}

function subscribeToPingItem(uuid: string, listener: Listener) {
  let listeners = pingListeners.get(uuid);
  if (!listeners) {
    listeners = new Set();
    pingListeners.set(uuid, listeners);
  }
  listeners.add(listener);

  return () => {
    listeners?.delete(listener);
    if (listeners && listeners.size === 0) {
      pingListeners.delete(uuid);
    }
  };
}

function getPingSnapshot(uuid: string) {
  return pingOverviewState.items.get(uuid) ?? EMPTY_PING;
}

export function useHomepagePingOverview() {
  const { data: me } = useAuth();
  const visibleUuids = useVisibleNodeUuids(me?.logged_in === true);
  const allMeta = useAllNodeMeta();
  const themeSettings = useThemeSettings();

  // 主题级隐藏节点首页已不渲染,这里也从 overview 拉取里剔除——否则仍会为其绑定的
  // ping 任务发请求、做聚合,纯属无效网络/计算开销。名称匹配需要完整 meta。
  const hiddenUuids = useMemo(
    () => collectMatchingNodeUuids(allMeta, themeSettings.hiddenNodes),
    [allMeta, themeSettings.hiddenNodes],
  );
  const effectiveUuids = useMemo(
    () =>
      hiddenUuids.size > 0
        ? visibleUuids.filter((uuid) => !hiddenUuids.has(uuid))
        : visibleUuids,
    [visibleUuids, hiddenUuids],
  );

  useEffect(() => {
    if (!themeSettings.isReady) return;
    activeConsumers += 1;
    ensurePingOverviewStarted(effectiveUuids, themeSettings.homepagePingBindings);
    return () => {
      activeConsumers -= 1;
      if (activeConsumers <= 0) {
        activeConsumers = 0;
        stopPingPolling();
      }
    };
  }, [themeSettings.homepagePingBindings, themeSettings.isReady, effectiveUuids]);
}

export function usePingMini(uuid: string): PingOverviewItem {
  const subscribe = useCallback(
    (cb: Listener) => (uuid ? subscribeToPingItem(uuid, cb) : () => undefined),
    [uuid],
  );
  const getSnapshot = useCallback(
    () => (uuid ? getPingSnapshot(uuid) : EMPTY_PING),
    [uuid],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function usePingMiniBuckets(
  ping: Pick<PingOverviewItem, "samples">,
  count?: number,
): PingOverviewBucket[] {
  return useMemo(() => {
    const now = Date.now();
    const totalWindowMs = 60 * 60 * 1000;
    const resolvedCount = count ?? MAX_VISIBLE_HOMEPAGE_PING_BUCKETS;
    const bucketMs = totalWindowMs / resolvedCount;
    const windowStart = now - bucketMs * resolvedCount;
    const totals = new Array<number>(resolvedCount).fill(0);
    const losts = new Array<number>(resolvedCount).fill(0);
    const positiveSums = new Array<number>(resolvedCount).fill(0);
    const positiveCounts = new Array<number>(resolvedCount).fill(0);

    for (const sample of ping.samples ?? []) {
      if (sample.time < windowStart || sample.time > now) continue;

      let bucketIndex = Math.floor((sample.time - windowStart) / bucketMs);
      if (bucketIndex < 0) continue;
      if (bucketIndex >= resolvedCount) bucketIndex = resolvedCount - 1;

      totals[bucketIndex] += 1;
      // value>=0 为成功（含 0=亚毫秒）计入均值；只有 value<0（-1）才计为丢包。
      if (sample.value >= 0) {
        positiveSums[bucketIndex] += sample.value;
        positiveCounts[bucketIndex] += 1;
      } else {
        losts[bucketIndex] += 1;
      }
    }

    return Array.from({ length: resolvedCount }, (_, index) => {
      const startAt = windowStart + index * bucketMs;
      const endAt = startAt + bucketMs;
      const total = totals[index];
      const lost = losts[index];
      const positiveCount = positiveCounts[index];

      return {
        index,
        value: positiveCount > 0 ? positiveSums[index] / positiveCount : null,
        loss: total > 0 ? (lost / total) * 100 : null,
        total,
        lost,
        startAt,
        endAt,
      };
    });
  }, [count, ping.samples]);
}
