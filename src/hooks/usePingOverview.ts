import { useCallback, useLayoutEffect, useMemo, useSyncExternalStore } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useMinuteClock } from "@/hooks/useClock";
import { useVisibleNodeUuids } from "@/hooks/useNode";
import { useThemeSettings } from "@/hooks/useThemeSettings";
import { useHiddenNodeUuids } from "@/hooks/useVisibleNodes";
import { getPingOverview, getPublicPingTasks } from "@/services/api";
import type {
  PingOverviewBucket,
  PingOverviewItem,
  PingOverviewTaskLoadState,
  PingRecord,
  PingTask,
} from "@/types/komari";
import { withTimeoutSignal } from "@/utils/abort";
import { parseTimestampMs } from "@/utils/format";
import {
  normalizeHomepagePingNodeTaskIds,
  resolveHomepagePingTaskId,
  type HomepagePingNodeTaskIds,
} from "@/utils/pingTasks";

const DEFAULT_PING_REFRESH_INTERVAL = 60_000;
const MIN_PING_REFRESH_INTERVAL = 10_000;
const MAX_PING_REFRESH_INTERVAL = 300_000;
const MAX_VISIBLE_HOMEPAGE_PING_BUCKETS = 24;
const PING_REQUEST_TIMEOUT_MS = 35_000;
const PUBLIC_PING_TASKS_TTL_MS = 60_000;
const MAX_TARGETED_OVERVIEW_TASKS = 4;

const EMPTY_PING: PingOverviewItem = {
  client: "",
  isAssigned: false,
  loadState: "pending",
  lastValue: null,
  samples: [],
  max: 1,
  loss: null,
};
const EMPTY_PING_BUCKETS: PingOverviewBucket[] = [];

type Listener = () => void;

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

function buildRequestKey(
  clientUuids: string[],
  overrides: HomepagePingNodeTaskIds,
) {
  const visible = new Set(clientUuids);
  const relevantOverrides = Object.entries(normalizeHomepagePingNodeTaskIds(overrides))
    .filter(([uuid]) => visible.has(uuid));
  return JSON.stringify([clientUuids, relevantOverrides]);
}

function equalSamples(
  left: PingOverviewItem["samples"],
  right: PingOverviewItem["samples"],
) {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (
      left[index]?.time !== right[index]?.time ||
      left[index]?.value !== right[index]?.value
    ) {
      return false;
    }
  }
  return true;
}

function equalPingItem(
  left: PingOverviewItem | undefined,
  right: PingOverviewItem | undefined,
) {
  if (left === right) return true;
  if (!left || !right) return false;
  return (
    left.client === right.client &&
    left.isAssigned === right.isAssigned &&
    left.taskName === right.taskName &&
    left.loadState === right.loadState &&
    left.lastValue === right.lastValue &&
    left.max === right.max &&
    left.loss === right.loss &&
    equalSamples(left.samples, right.samples)
  );
}

export function buildPingOverviewItems(
  taskId: number,
  records: PingRecord[],
  taskName?: string,
) {
  const grouped = new Map<string, PingRecord[]>();
  for (const record of records) {
    if (record.task_id !== taskId || !record.client) continue;
    const current = grouped.get(record.client);
    if (current) current.push(record);
    else grouped.set(record.client, [record]);
  }

  const result = new Map<string, PingOverviewItem>();
  for (const [client, clientRecords] of grouped) {
    const sorted = clientRecords
      .map((record) => ({ record, time: parseTimestampMs(record.time) }))
      .sort((left, right) => left.time - right.time);
    const samples: PingOverviewItem["samples"] = [];
    let max = 1;
    let lost = 0;
    for (const { record, time } of sorted) {
      if (time > 0) samples.push({ time, value: record.value });
      if (record.value < 0) lost += 1;
      else if (record.value > max) max = record.value;
    }
    const latest = sorted.at(-1)?.record;
    result.set(client, {
      client,
      isAssigned: true,
      taskName,
      loadState: "ready",
      lastValue: latest && latest.value >= 0 ? latest.value : null,
      samples,
      max,
      loss: sorted.length > 0 ? (lost / sorted.length) * 100 : null,
    });
  }
  return result;
}

function emptyPing(
  client: string,
  isAssigned: boolean,
  loadState: PingOverviewTaskLoadState = "ready",
  taskName?: string,
): PingOverviewItem {
  return {
    client,
    isAssigned,
    taskName,
    loadState,
    lastValue: null,
    samples: [],
    max: 1,
    loss: null,
  };
}

interface PingOverviewMapResult {
  assignmentKey: string;
  intervalMs: number;
  singleItems: Map<string, PingOverviewItem>;
  selectedTaskIdsByClient: Map<string, number>;
}

let cachedPublicTasks: { tasks: PingTask[]; expiresAt: number } | null = null;
let inFlightPublicTasksPromise: Promise<PingTask[]> | null = null;
let inFlightPublicTasksController: AbortController | null = null;
let publicTasksCacheEpoch = 0;

export function resetHomepagePingTasksCache() {
  publicTasksCacheEpoch += 1;
  cachedPublicTasks = null;
  inFlightPublicTasksPromise = null;
  inFlightPublicTasksController?.abort();
  inFlightPublicTasksController = null;
}

async function loadCachedPublicPingTasks(options?: { signal?: AbortSignal }): Promise<PingTask[]> {
  const now = Date.now();
  if (cachedPublicTasks && cachedPublicTasks.expiresAt > now) {
    return cachedPublicTasks.tasks;
  }
  if (options?.signal?.aborted) {
    throw options.signal.reason ?? new DOMException("Aborted", "AbortError");
  }

  if (!inFlightPublicTasksPromise) {
    const requestEpoch = publicTasksCacheEpoch;
    const controller = new AbortController();
    inFlightPublicTasksController = controller;
    const requestPromise = getPublicPingTasks({ signal: controller.signal })
      .then((tasks) => {
        if (requestEpoch === publicTasksCacheEpoch) {
          cachedPublicTasks = {
            tasks,
            expiresAt: Date.now() + PUBLIC_PING_TASKS_TTL_MS,
          };
        }
        return tasks;
      })
      .finally(() => {
        if (inFlightPublicTasksPromise === requestPromise) {
          inFlightPublicTasksPromise = null;
        }
        if (inFlightPublicTasksController === controller) {
          inFlightPublicTasksController = null;
        }
      });
    inFlightPublicTasksPromise = requestPromise;
  }

  const activePromise = inFlightPublicTasksPromise;
  if (!options?.signal) return await activePromise;
  return await new Promise<PingTask[]>((resolve, reject) => {
    const onAbort = () =>
      reject(options.signal?.reason ?? new DOMException("Aborted", "AbortError"));
    options.signal?.addEventListener("abort", onAbort, { once: true });
    activePromise
      .then(resolve, reject)
      .finally(() => options.signal?.removeEventListener("abort", onAbort));
  });
}

/**
 * 先解析可见节点实际使用的 Ping 任务，再按需请求对应线路记录：
 * - 无绑定任务时不发历史记录请求；
 * - 单任务或少量任务子集时传入 `task_id` 精准拉取，避免无关线路占用带宽与 4000 条采样额度；
 * - 公开任务列表默认走短 TTL 缓存，减少高频轮询下的重复请求。
 */
export async function buildPingOverviewMap(
  hours: number,
  clientUuids: string[],
  overrides: HomepagePingNodeTaskIds,
  signal?: AbortSignal,
  loadOverview: typeof getPingOverview = getPingOverview,
  loadTasks: typeof getPublicPingTasks = loadCachedPublicPingTasks,
): Promise<PingOverviewMapResult> {
  const normalizedUuids = normalizeVisibleUuids(clientUuids);
  const normalizedOverrides = normalizeHomepagePingNodeTaskIds(overrides);
  const assignmentKey = buildRequestKey(normalizedUuids, normalizedOverrides);
  if (normalizedUuids.length === 0) {
    return {
      assignmentKey,
      intervalMs: DEFAULT_PING_REFRESH_INTERVAL,
      singleItems: new Map(),
      selectedTaskIdsByClient: new Map(),
    };
  }

  const selectedTaskIdsByClient = new Map<string, number>();
  let selectedTaskIds: number[] = [];
  let tasks: PingTask[] = [];

  const records = await withTimeoutSignal(
    async (requestSignal) => {
      tasks = await loadTasks({ signal: requestSignal });
      selectedTaskIdsByClient.clear();
      for (const uuid of normalizedUuids) {
        const taskId = resolveHomepagePingTaskId(uuid, tasks, normalizedOverrides);
        if (taskId != null) selectedTaskIdsByClient.set(uuid, taskId);
      }

      selectedTaskIds = [...new Set(selectedTaskIdsByClient.values())].sort(
        (left, right) => left - right,
      );
      if (selectedTaskIds.length === 0) {
        return [];
      }

      const useTargetedRequests =
        selectedTaskIds.length === 1 ||
        (selectedTaskIds.length <= MAX_TARGETED_OVERVIEW_TASKS &&
          selectedTaskIds.length < tasks.length);

      if (useTargetedRequests) {
        const responses = await Promise.all(
          selectedTaskIds.map((taskId) =>
            loadOverview(hours, taskId, {
              signal: requestSignal,
              entityIds: normalizedUuids,
            }),
          ),
        );
        return responses.flatMap((response) => response.records);
      }

      const loadedOverview = await loadOverview(hours, undefined, {
        signal: requestSignal,
        entityIds: normalizedUuids,
      });
      return loadedOverview.records;
    },
    PING_REQUEST_TIMEOUT_MS,
    signal,
  );

  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const taskName = (taskId: number) =>
    taskById.get(taskId)?.name.trim() || `任务 #${taskId}`;
  const itemsByTask = new Map(
    selectedTaskIds.map((taskId) => [
      taskId,
      buildPingOverviewItems(taskId, records, taskName(taskId)),
    ]),
  );
  const singleItems = new Map<string, PingOverviewItem>();
  for (const uuid of normalizedUuids) {
    const taskId = selectedTaskIdsByClient.get(uuid);
    singleItems.set(
      uuid,
      taskId == null
        ? emptyPing(uuid, false)
        : (itemsByTask.get(taskId)?.get(uuid) ??
          emptyPing(uuid, true, "ready", taskName(taskId))),
    );
  }

  const intervals = selectedTaskIds.map((taskId) =>
    normalizeRefreshInterval(taskById.get(taskId)?.interval),
  );
  return {
    assignmentKey,
    intervalMs: intervals.length > 0
      ? Math.min(...intervals)
      : DEFAULT_PING_REFRESH_INTERVAL,
    singleItems,
    selectedTaskIdsByClient,
  };
}

interface PingOverviewStoreState {
  assignmentKey: string;
  intervalMs: number;
  singleItems: Map<string, PingOverviewItem>;
}

let pingOverviewState: PingOverviewStoreState = {
  assignmentKey: "",
  intervalMs: DEFAULT_PING_REFRESH_INTERVAL,
  singleItems: new Map(),
};
let scheduledVisibleUuids: string[] = [];
let scheduledVisibleKey = "";
let scheduledOverrides: HomepagePingNodeTaskIds = {};
let scheduledSelectionKey = "";
let pingRefreshTimer: number | null = null;
let pingAbortController: AbortController | null = null;
let pingRefreshInFlight = false;
let pingPollingDisposed = false;
let activeConsumers = 0;
const pingListeners = new Map<string, Set<Listener>>();

function notifyPingListeners(uuids: Iterable<string>) {
  for (const uuid of uuids) {
    for (const listener of pingListeners.get(uuid) ?? []) listener();
  }
}

function commitPingOverview(
  assignmentKey: string,
  intervalMs: number,
  singleItems: Map<string, PingOverviewItem>,
) {
  const previous = pingOverviewState.singleItems;
  const next = new Map<string, PingOverviewItem>();
  const touched = new Set<string>();

  for (const [uuid, item] of singleItems) {
    const previousItem = previous.get(uuid);
    if (equalPingItem(previousItem, item)) next.set(uuid, previousItem ?? item);
    else {
      next.set(uuid, item);
      touched.add(uuid);
    }
  }
  for (const uuid of previous.keys()) {
    if (!next.has(uuid)) touched.add(uuid);
  }

  const metadataChanged =
    pingOverviewState.assignmentKey !== assignmentKey ||
    pingOverviewState.intervalMs !== intervalMs;
  if (!metadataChanged && touched.size === 0) return;
  pingOverviewState = { assignmentKey, intervalMs, singleItems: next };
  notifyPingListeners(touched);
}

function schedulePingRefresh(intervalMs: number) {
  if (pingRefreshTimer != null) window.clearTimeout(pingRefreshTimer);
  pingRefreshTimer = null;
  if (pingPollingDisposed || activeConsumers <= 0 || scheduledVisibleUuids.length === 0) {
    return;
  }
  pingRefreshTimer = window.setTimeout(() => {
    pingRefreshTimer = null;
    void refreshPingOverview();
  }, intervalMs);
}

function stopPingPolling() {
  if (pingRefreshTimer != null) window.clearTimeout(pingRefreshTimer);
  pingRefreshTimer = null;
  pingAbortController?.abort();
  pingAbortController = null;
  resetHomepagePingTasksCache();
}

function markPingRefreshFailed() {
  const failedItems = new Map<string, PingOverviewItem>();
  for (const [uuid, item] of pingOverviewState.singleItems) {
    failedItems.set(
      uuid,
      item.isAssigned ? { ...item, loadState: "error" } : item,
    );
  }
  commitPingOverview(
    pingOverviewState.assignmentKey,
    pingOverviewState.intervalMs,
    failedItems,
  );
}

async function refreshPingOverview() {
  if (pingPollingDisposed || pingRefreshInFlight || activeConsumers <= 0) return;
  if (scheduledVisibleUuids.length === 0) return;

  pingRefreshInFlight = true;
  const visibleKey = scheduledVisibleKey;
  const selectionKey = scheduledSelectionKey;
  const controller = new AbortController();
  pingAbortController = controller;
  const isCurrent = () =>
    !controller.signal.aborted &&
    visibleKey === scheduledVisibleKey &&
    selectionKey === scheduledSelectionKey;

  try {
    const result = await buildPingOverviewMap(
      1,
      scheduledVisibleUuids,
      scheduledOverrides,
      controller.signal,
    );
    if (!isCurrent()) return;
    commitPingOverview(result.assignmentKey, result.intervalMs, result.singleItems);
    schedulePingRefresh(result.intervalMs);
  } catch {
    if (!isCurrent()) return;
    markPingRefreshFailed();
    schedulePingRefresh(DEFAULT_PING_REFRESH_INTERVAL);
  } finally {
    pingRefreshInFlight = false;
    if (pingAbortController === controller) pingAbortController = null;
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
  overrides: HomepagePingNodeTaskIds,
) {
  const normalizedVisibleUuids = normalizeVisibleUuids(visibleUuids);
  const normalizedOverrides = normalizeHomepagePingNodeTaskIds(overrides);
  const visibleKey = normalizedVisibleUuids.join("|");
  const selectionKey = buildRequestKey(normalizedVisibleUuids, normalizedOverrides);

  if (visibleKey !== scheduledVisibleKey || selectionKey !== scheduledSelectionKey) {
    const previousOverrides = scheduledOverrides;
    scheduledVisibleUuids = normalizedVisibleUuids;
    scheduledVisibleKey = visibleKey;
    scheduledOverrides = normalizedOverrides;
    scheduledSelectionKey = selectionKey;
    pingAbortController?.abort();
    if (pingRefreshTimer != null) window.clearTimeout(pingRefreshTimer);
    pingRefreshTimer = null;
    // 保留未变更节点的已有 Ping 数据，避免节点增删或登录态就绪时整屏闪烁回 pending。
    const preservedItems = new Map<string, PingOverviewItem>();
    for (const uuid of normalizedVisibleUuids) {
      const hasPrev = Object.prototype.hasOwnProperty.call(previousOverrides, uuid);
      const hasNext = Object.prototype.hasOwnProperty.call(normalizedOverrides, uuid);
      if (hasPrev === hasNext && previousOverrides[uuid] === normalizedOverrides[uuid]) {
        const existing = pingOverviewState.singleItems.get(uuid);
        if (existing) preservedItems.set(uuid, existing);
      }
    }
    commitPingOverview(selectionKey, DEFAULT_PING_REFRESH_INTERVAL, preservedItems);
  }

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
    if (listeners?.size === 0) pingListeners.delete(uuid);
  };
}

function getPingSnapshot(uuid: string) {
  return pingOverviewState.singleItems.get(uuid) ?? EMPTY_PING;
}

export function useHomepagePingOverview() {
  const { data: me } = useAuth();
  const visibleUuids = useVisibleNodeUuids(me?.logged_in === true);
  const hiddenUuids = useHiddenNodeUuids();
  const themeSettings = useThemeSettings();
  const effectiveUuids = useMemo(
    () => visibleUuids.filter((uuid) => !hiddenUuids.has(uuid)),
    [hiddenUuids, visibleUuids],
  );

  useLayoutEffect(() => {
    if (!themeSettings.isReady) return;
    activeConsumers += 1;
    ensurePingOverviewStarted(
      effectiveUuids,
      themeSettings.homepagePingNodeTaskIds,
    );
    return () => {
      activeConsumers = Math.max(0, activeConsumers - 1);
      if (activeConsumers === 0) stopPingPolling();
    };
  }, [effectiveUuids, themeSettings.homepagePingNodeTaskIds, themeSettings.isReady]);
}

export function useNodePingOverview(
  uuid: string,
  enabled = true,
): PingOverviewItem {
  const subscribe = useCallback(
    (listener: Listener) =>
      uuid && enabled ? subscribeToPingItem(uuid, listener) : () => undefined,
    [enabled, uuid],
  );
  const getSnapshot = useCallback(
    () => (uuid && enabled ? getPingSnapshot(uuid) : EMPTY_PING),
    [enabled, uuid],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function buildPingBuckets(
  ping: Pick<PingOverviewItem, "samples">,
  count?: number,
  now = Date.now(),
): PingOverviewBucket[] {
  const totalWindowMs = 60 * 60 * 1000;
  const requestedCount = count ?? MAX_VISIBLE_HOMEPAGE_PING_BUCKETS;
  const resolvedCount = Number.isFinite(requestedCount) && requestedCount > 0
    ? Math.min(240, Math.max(1, Math.round(requestedCount)))
    : MAX_VISIBLE_HOMEPAGE_PING_BUCKETS;
  const bucketMs = totalWindowMs / resolvedCount;
  const windowStart = now - totalWindowMs;
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
    if (sample.value < 0) losts[bucketIndex] += 1;
    else {
      positiveSums[bucketIndex] += sample.value;
      positiveCounts[bucketIndex] += 1;
    }
  }

  return Array.from({ length: resolvedCount }, (_, index) => {
    const total = totals[index];
    const lost = Math.round(losts[index]);
    const positiveCount = positiveCounts[index];
    const startAt = windowStart + index * bucketMs;
    return {
      index,
      value: positiveCount > 0 ? positiveSums[index] / positiveCount : null,
      loss: total > 0 ? (lost / total) * 100 : null,
      total,
      lost,
      startAt,
      endAt: startAt + bucketMs,
    };
  });
}

export function usePingBuckets(
  ping: Pick<PingOverviewItem, "samples">,
  count?: number,
  enabled = true,
): PingOverviewBucket[] {
  const { samples } = ping;
  const now = useMinuteClock(enabled);
  return useMemo(
    () => enabled ? buildPingBuckets({ samples }, count, now) : EMPTY_PING_BUCKETS,
    [count, enabled, now, samples],
  );
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    pingPollingDisposed = true;
    activeConsumers = 0;
    stopPingPolling();
  });
}
