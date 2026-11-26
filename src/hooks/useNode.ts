import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
  retainStore,
  getAllNodeMetaSnapshot,
  getFailureStreakSnapshot,
  getHomeNodeSummariesSnapshot,
  getNodeMetaSnapshot,
  getNodeMetricsSnapshot,
  getNodeTrafficTrendSnapshot,
  getNodeOnlineSummariesSnapshot,
  getStoreHydrationSnapshot,
  getVisibleNodeUuidsSnapshot,
  subscribeFailureStreak,
  subscribeHomeNodeSummaries,
  subscribeNodeOnlineSummaries,
  subscribeAllNodes,
  subscribeStoreHydration,
  subscribeVisibleNodeUuids,
  subscribeToNodeMeta,
  subscribeToNodeMetrics,
  subscribeToNodeTrafficTrend,
  type HomeNodeSummary,
  type NodeOnlineSummary,
} from "@/services/wsStore";
import type { NodeInfo, NodeMetrics, TrafficTrendSample } from "@/types/komari";

const noopUnsubscribe = () => undefined;

function useEnsured(enabled = true) {
  useEffect(() => {
    if (enabled) return retainStore();
  }, [enabled]);
}

export function useNodeMeta(uuid: string): NodeInfo | undefined {
  useEnsured();
  return useNodeMetaSnapshot(uuid);
}

function useNodeMetaSnapshot(uuid: string): NodeInfo | undefined {
  const subscribe = useCallback(
    (callback: () => void) => subscribeToNodeMeta(uuid, callback),
    [uuid],
  );
  const getSnapshot = useCallback(() => getNodeMetaSnapshot(uuid), [uuid]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useNodeMetrics(uuid: string, enabled = true): NodeMetrics | undefined {
  useEnsured(enabled);
  return useNodeMetricsSnapshot(uuid, enabled);
}

function useNodeMetricsSnapshot(uuid: string, enabled = true): NodeMetrics | undefined {
  const subscribe = useCallback(
    (callback: () => void) =>
      enabled ? subscribeToNodeMetrics(uuid, callback) : noopUnsubscribe,
    [uuid, enabled],
  );
  const getSnapshot = useCallback(
    () => (enabled ? getNodeMetricsSnapshot(uuid) : undefined),
    [uuid, enabled],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

function useNodeTrafficTrendSnapshot(
  uuid: string,
): { up: TrafficTrendSample[]; down: TrafficTrendSample[] } {
  const subscribe = useCallback(
    (callback: () => void) => subscribeToNodeTrafficTrend(uuid, callback),
    [uuid],
  );
  const getSnapshot = useCallback(() => getNodeTrafficTrendSnapshot(uuid), [uuid]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useNodeCardSnapshots(uuid: string) {
  useEnsured();
  return {
    meta: useNodeMetaSnapshot(uuid),
    metrics: useNodeMetricsSnapshot(uuid),
    trafficTrend: useNodeTrafficTrendSnapshot(uuid),
  };
}

export function useVisibleNodeUuids(includeHidden = false): string[] {
  useEnsured();
  const getSnapshot = useCallback(
    () => getVisibleNodeUuidsSnapshot(includeHidden),
    [includeHidden],
  );
  return useSyncExternalStore(
    subscribeVisibleNodeUuids,
    getSnapshot,
    getSnapshot,
  );
}

export function useAllNodeMeta(): NodeInfo[] {
  useEnsured();
  return useSyncExternalStore(
    subscribeAllNodes,
    getAllNodeMetaSnapshot,
    getAllNodeMetaSnapshot,
  );
}

const EMPTY_HOME_NODE_SUMMARIES: HomeNodeSummary[] = [];

export function useHomeNodeSummaries(enabled = true): HomeNodeSummary[] {
  useEnsured(enabled);
  const subscribe = useCallback(
    (listener: () => void) =>
      enabled ? subscribeHomeNodeSummaries(listener) : noopUnsubscribe,
    [enabled],
  );
  const getSnapshot = useCallback(
    () => (enabled ? getHomeNodeSummariesSnapshot() : EMPTY_HOME_NODE_SUMMARIES),
    [enabled],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useNodeOnlineSummaries(): NodeOnlineSummary[] {
  useEnsured();
  return useSyncExternalStore(
    subscribeNodeOnlineSummaries,
    getNodeOnlineSummariesSnapshot,
    getNodeOnlineSummariesSnapshot,
  );
}

const EMPTY_STORE_STATUS = {
  hydrated: false,
  nodeInfoError: false,
} as const;

export function useNodeStoreStatus(enabled = true) {
  useEnsured(enabled);
  const subscribe = useCallback(
    (listener: () => void) =>
      enabled ? subscribeStoreHydration(listener) : noopUnsubscribe,
    [enabled],
  );
  const getSnapshot = useCallback(
    () => (enabled ? getStoreHydrationSnapshot() : EMPTY_STORE_STATUS),
    [enabled],
  );
  return useSyncExternalStore(
    subscribe,
    getSnapshot,
    getSnapshot,
  );
}

export function useNodeFailureStreak(enabled = true): number {
  useEnsured(enabled);
  const subscribe = useCallback(
    (listener: () => void) =>
      enabled ? subscribeFailureStreak(listener) : noopUnsubscribe,
    [enabled],
  );
  const getSnapshot = useCallback(
    () => (enabled ? getFailureStreakSnapshot() : 0),
    [enabled],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
