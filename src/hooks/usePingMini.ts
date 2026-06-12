import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { useVisibleNodeUuids } from "@/hooks/useNode";
import { useThemeSettings } from "@/hooks/useThemeSettings";
import { getPingOverview } from "@/services/api";
import type { PingOverviewBucket, PingOverviewItem } from "@/types/komari";
import {
  invertHomepagePingTaskBindings,
  type HomepagePingTaskBindings,
} from "@/utils/pingTasks";

const DEFAULT_PING_REFRESH_INTERVAL = 60_000;
const MIN_PING_REFRESH_INTERVAL = 10_000;
const MAX_PING_REFRESH_INTERVAL = 300_000;
// Homepage mini charts intentionally stay at 24 frontend aggregation buckets.
// The homepage cards are for quick trend reading, so we aggregate the latest hour into
// 24 equal windows instead of showing one raw backend bucket per bar.
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
interface PingOverviewStoreEntry {
  item: PingOverviewItem;
  missingRounds: number;
}

const PING_OVERVIEW_MISSING_GRACE_ROUNDS = 1;

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
    if (record.value <= 0) {
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
      lastValue: latestRecord && latestRecord.value > 0 ? latestRecord.value : null,
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

async function buildOverviewMap(
  hours: number,
  clientUuids: string[],
  bindings: HomepagePingTaskBindings,
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
    selectedTaskIds.map(async (taskId) => ({
      taskId,
      overview: await getPingOverview(hours, taskId),
    })),
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
  items: Map<string, PingOverviewStoreEntry>;
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
let activeConsumers = 0;
const pingListeners = new Map<string, Set<Listener>>();

function schedulePingRefresh(intervalMs: number) {
  if (pingRefreshTimer != null) {
    window.clearTimeout(pingRefreshTimer);
    pingRefreshTimer = null;
  }
  // Stop polling once no component is consuming the overview. The chain restarts
  // from ensurePingOverviewStarted when a consumer mounts again.
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
}

function commitPingOverview(
  assignmentKey: string,
  intervalMs: number,
  items: Map<string, PingOverviewItem>,
) {
  const prevItems = pingOverviewState.items;
  const nextItems = new Map<string, PingOverviewStoreEntry>();
  const touched = new Set<string>();
  // Bookkeeping (missingRounds) advanced without a visible change. We must still
  // persist the new state so the grace counter can eventually expire a vanished
  // client; otherwise the early-return below discards the increment and the item
  // is preserved forever.
  let bookkeepingChanged = false;
  const keys = new Set<string>([...prevItems.keys(), ...items.keys()]);
  const preserveMissing = pingOverviewState.assignmentKey === assignmentKey;

  for (const key of keys) {
    const prevEntry = prevItems.get(key);
    const prev = prevEntry?.item;
    const next = items.get(key);

    if (!next) {
      if (
        preserveMissing &&
        prevEntry &&
        prevEntry.missingRounds < PING_OVERVIEW_MISSING_GRACE_ROUNDS
      ) {
        nextItems.set(key, {
          ...prevEntry,
          missingRounds: prevEntry.missingRounds + 1,
        });
        bookkeepingChanged = true;
        continue;
      }
      if (prevEntry) touched.add(key);
      continue;
    }

    if (equalPingItem(prev, next)) {
      nextItems.set(key, {
        item: prev ?? next,
        missingRounds: 0,
      });
      continue;
    }

    nextItems.set(key, {
      item: next,
      missingRounds: 0,
    });
    touched.add(key);
  }

  if (
    pingOverviewState.assignmentKey === assignmentKey &&
    pingOverviewState.intervalMs === intervalMs &&
    touched.size === 0 &&
    nextItems.size === prevItems.size &&
    !bookkeepingChanged
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

  try {
    if (scheduledVisibleUuids.length === 0) {
      commitPingOverview("", DEFAULT_PING_REFRESH_INTERVAL, new Map());
      return;
    }

    const next = await buildOverviewMap(
      1,
      scheduledVisibleUuids,
      scheduledBindings,
    );
    if (
      visibleKey === scheduledVisibleKey &&
      bindingsKey === scheduledBindingsKey
    ) {
      commitPingOverview(next.assignmentKey, next.intervalMs, next.items);
      schedulePingRefresh(next.intervalMs);
    }
  } catch {
    if (
      visibleKey === scheduledVisibleKey &&
      bindingsKey === scheduledBindingsKey
    ) {
      schedulePingRefresh(DEFAULT_PING_REFRESH_INTERVAL);
    }
  } finally {
    pingRefreshInFlight = false;
    if (
      visibleKey !== scheduledVisibleKey ||
      bindingsKey !== scheduledBindingsKey
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

  // Restart whenever there is no pending request and no scheduled tick — this
  // covers both the initial mount and resuming after polling was stopped.
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
  return pingOverviewState.items.get(uuid)?.item ?? EMPTY_PING;
}

export function useHomepagePingOverview() {
  const visibleUuids = useVisibleNodeUuids();
  const themeSettings = useThemeSettings();

  useEffect(() => {
    activeConsumers += 1;
    ensurePingOverviewStarted(visibleUuids, themeSettings.homepagePingBindings);
    return () => {
      activeConsumers -= 1;
      if (activeConsumers <= 0) {
        activeConsumers = 0;
        stopPingPolling();
      }
    };
  }, [themeSettings.homepagePingBindings, visibleUuids]);
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
      if (sample.value > 0) {
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
