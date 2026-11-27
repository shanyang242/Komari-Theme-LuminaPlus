import { useEffect, useMemo, useRef, useState } from "react";
import type { HomeNodeSummary } from "@/services/wsStore";
import {
  HOME_SPEED_ENTER_BPS,
  HOME_SPEED_EXIT_BPS,
  HOME_SPEED_RESORT_INTERVAL_MS,
  HOME_SPEED_SAMPLE_WINDOW,
  reconcileSpeedOrder,
  sortHomeNodes,
  type HomeSortDirection,
  type HomeSortField,
} from "@/utils/homeSort";

interface Params {
  nodes: HomeNodeSummary[];
  field: HomeSortField;
  direction: HomeSortDirection;
  nameByUuid: Map<string, string>;
  priceByUuid: Map<string, number | null>;
}

const EMPTY_NUMBER_MAP = new Map<string, number>();
const EMPTY_NAME_MAP = new Map<string, string>();
const EMPTY_PRICE_MAP = new Map<string, number | null>();
const EMPTY_SET = new Set<string>();

export function useHomeNodeOrder({
  nodes,
  field,
  direction,
  nameByUuid,
  priceByUuid,
}: Params): HomeNodeSummary[] {
  const ringRef = useRef<Map<string, number[]>>(new Map());
  const nodesRef = useRef(nodes);
  const membershipKey = useMemo(
    () => (field === "speed" ? nodes.map((node) => node.uuid).sort().join("\0") : ""),
    [field, nodes],
  );
  useEffect(() => {
    if (field !== "speed") {
      if (ringRef.current.size) ringRef.current.clear();
      return;
    }
    nodesRef.current = nodes;
    const ring = ringRef.current;
    const seen = new Set<string>();
    for (const node of nodes) {
      seen.add(node.uuid);
      if (node.online !== true) {
        ring.delete(node.uuid);
        continue;
      }
      const total = (node.netUp || 0) + (node.netDown || 0);
      const arr = ring.get(node.uuid);
      if (arr) {
        arr.push(total);
        if (arr.length > HOME_SPEED_SAMPLE_WINDOW) arr.shift();
      } else {
        ring.set(node.uuid, [total]);
      }
    }
    for (const uuid of ring.keys()) {
      if (!seen.has(uuid)) ring.delete(uuid);
    }
  }, [nodes, field]);

  const stableOrder = useMemo(() => {
    if (field === "speed") return null;
    return sortHomeNodes(nodes, field, direction, {
      nameByUuid,
      speedAvgByUuid: EMPTY_NUMBER_MAP,
      priceByUuid,
      speedActive: EMPTY_SET,
    });
  }, [field, direction, nodes, nameByUuid, priceByUuid]);

  const [speedUuids, setSpeedUuids] = useState<string[]>([]);
  const activeRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (field !== "speed") {
      activeRef.current = new Set();
      return;
    }
    const recompute = () => {
      const current = nodesRef.current;
      const avg = new Map<string, number>();
      for (const node of current) {
        const arr = ringRef.current.get(node.uuid);
        avg.set(node.uuid, arr && arr.length ? arr.reduce((sum, v) => sum + v, 0) / arr.length : 0);
      }
      const next = new Set<string>();
      for (const node of current) {
        if (node.online === false) continue;
        const value = avg.get(node.uuid) ?? 0;
        const threshold = activeRef.current.has(node.uuid) ? HOME_SPEED_EXIT_BPS : HOME_SPEED_ENTER_BPS;
        if (value >= threshold) next.add(node.uuid);
      }
      activeRef.current = next;
      const ordered = sortHomeNodes(current, "speed", direction, {
        nameByUuid: EMPTY_NAME_MAP,
        speedAvgByUuid: avg,
        priceByUuid: EMPTY_PRICE_MAP,
        speedActive: next,
      });
      const nextUuids = ordered.map((node) => node.uuid);
      setSpeedUuids((previous) =>
        previous.length === nextUuids.length &&
        previous.every((uuid, index) => uuid === nextUuids[index])
          ? previous
          : nextUuids,
      );
    };
    recompute();
    const id = window.setInterval(recompute, HOME_SPEED_RESORT_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [field, direction, membershipKey]);

  const speedOrder = useMemo(
    () => (field === "speed" ? reconcileSpeedOrder(nodes, speedUuids) : null),
    [field, nodes, speedUuids],
  );

  return (field === "speed" ? speedOrder : stableOrder) ?? nodes;
}
