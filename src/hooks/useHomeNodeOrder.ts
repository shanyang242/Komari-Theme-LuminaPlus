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

// 把分组筛完的节点按所选维度排序。除「实时网速」外的维度数据本身不抖,直接响应式排序;
// 「实时网速」走三层防抖:近 3 样本均值(键平滑)+ 0.5进/0.3出 滞回 + 每 5s 才重算站位
// (两次之间顺序冻结,卡片数字仍每拍实时刷新)。

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
  // 近 N 样本速率环(总速率 = ↑+↓)。只有「实时网速」维度才维护——其余维度不做这份每 tick 的
  // O(n) 工作。切到 speed 时用当前 tick 现场 seed 一拍、随后每拍续上;切走则清空,免得下次带着
  // 陈旧样本。nodesRef 供 5s 定时器读最新 nodes(只在 speed 下才需要)。
  const ringRef = useRef<Map<string, number[]>>(new Map());
  const nodesRef = useRef(nodes);
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

  // 非实时网速维度:响应式排序。
  const stableOrder = useMemo(() => {
    if (field === "speed") return null;
    return sortHomeNodes(nodes, field, direction, {
      nameByUuid,
      speedAvgByUuid: EMPTY_NUMBER_MAP,
      priceByUuid,
      speedActive: EMPTY_SET,
    });
  }, [field, direction, nodes, nameByUuid, priceByUuid]);

  // 实时网速:5s 节奏重算 uuid 顺序 + 滞回活跃集。读 nodesRef.current,所以不把 nodes 放进依赖、
  // 避免每 2s 数据 tick 重置定时器。speed 维度排序只用到均值与活跃集,name/price 用不上——传空 Map、
  // 依赖也只收 [field, direction],免得汇率或 meta 变化无意义重建定时器。
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
      // 滞回:已活跃的用低门(0.3)判去留,未活跃的用高门(0.5)判进入。
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
      setSpeedUuids(ordered.map((node) => node.uuid));
    };
    recompute();
    const id = window.setInterval(recompute, HOME_SPEED_RESORT_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [field, direction]);

  // 把冻结的 uuid 顺序映射回当前节点。注意是按「当前」在线态即时重新分段:5s 间隔内掉线的
  // 节点立刻沉底(见 reconcileSpeedOrder),不会卡在原位等下一次重排。
  const speedOrder = useMemo(
    () => (field === "speed" ? reconcileSpeedOrder(nodes, speedUuids) : null),
    [field, nodes, speedUuids],
  );

  return (field === "speed" ? speedOrder : stableOrder) ?? nodes;
}
