import type { HomeNodeSummary } from "@/services/wsStore";

// 首页节点排序:访客可在首页临时切换的排序维度。默认序仍是后端 weight,离线永远沉底(见下,
// 不可通过任何方式改变)。只有「实时网速」需要防抖(键平滑 + 滞回 + 慢重排),其余维度数据本身
// 不抖,直接响应式排序。

export type HomeSortField = "default" | "name" | "speed" | "traffic" | "price";
export type HomeSortDirection = "asc" | "desc";

export const HOME_SORT_FIELDS: readonly HomeSortField[] = [
  "default",
  "name",
  "speed",
  "traffic",
  "price",
];

export const HOME_SORT_FIELD_LABELS: Record<HomeSortField, string> = {
  default: "默认",
  name: "名称",
  speed: "实时网速",
  traffic: "累计流量",
  price: "价格",
};

// 每个维度的自然默认方向:文本升序(A→Z),数值降序(高的在前)。
export const HOME_SORT_NATURAL_DIRECTION: Record<HomeSortField, HomeSortDirection> = {
  default: "asc",
  name: "asc",
  speed: "desc",
  traffic: "desc",
  price: "desc",
};

export function isHomeSortField(value: unknown): value is HomeSortField {
  return typeof value === "string" && (HOME_SORT_FIELDS as readonly string[]).includes(value);
}

export function isHomeSortDirection(value: unknown): value is HomeSortDirection {
  return value === "asc" || value === "desc";
}

// 实时网速防抖参数(单位:字节/秒;1MB/s = 1024×1024 B/s,取「上行+下行」合计)。
// 滞回门:冲上 0.5MB/s 才浮入活跃组参与往前排;已在活跃组的,要跌破 0.3MB/s 才落回默认序——
// 0.3~0.5 之间是缓冲带,卡在 0.5 上下的节点不会反复横跳。
export const HOME_SPEED_ENTER_BPS = 0.5 * 1024 * 1024;
export const HOME_SPEED_EXIT_BPS = 0.3 * 1024 * 1024;
// 平滑窗口:近 3 个样本(实时数据每 ~2s 一拍,≈6s 均值),只磨单拍毛刺、不拖慢真实变化。
export const HOME_SPEED_SAMPLE_WINDOW = 3;
// 重排节奏:站位每 5s 才重算一次(卡片数字仍每拍实时刷新),两次之间顺序冻结。
export const HOME_SPEED_RESORT_INTERVAL_MS = 5000;

export interface HomeSortContext {
  /** uuid → 展示名(摘要里没有 name,需由 allMeta 注入)。 */
  nameByUuid: Map<string, string>;
  /** uuid → 近 3 样本平均总速率(字节/秒),仅「实时网速」维度用。 */
  speedAvgByUuid: Map<string, number>;
  /** uuid → 月化价格(CNY),无价格为 null,仅「价格」维度用。 */
  priceByUuid: Map<string, number | null>;
  /** 通过滞回门、当前算「活跃」的节点集合,仅「实时网速」维度用。 */
  speedActive: Set<string>;
}

// 段位(始终生效,离线置底不可改):
//   0 = 在线·参与排位     → 按所选维度排
//   1 = 在线·未达标/无值   → 回落默认 weight 序(实时网速未达 0.5、或价格缺失)
//   2 = 离线              → 永远沉底,组内按 weight
function segmentOf(node: HomeNodeSummary, field: HomeSortField, ctx: HomeSortContext): 0 | 1 | 2 {
  if (node.online === false) return 2;
  if (field === "speed") return ctx.speedActive.has(node.uuid) ? 0 : 1;
  if (field === "price") return ctx.priceByUuid.get(node.uuid) != null ? 0 : 1;
  return 0;
}

function primaryValue(
  node: HomeNodeSummary,
  field: HomeSortField,
  ctx: HomeSortContext,
): number | string {
  switch (field) {
    case "name":
      return ctx.nameByUuid.get(node.uuid) ?? node.uuid;
    case "speed":
      return ctx.speedAvgByUuid.get(node.uuid) ?? 0;
    case "traffic":
      return (node.trafficUp || 0) + (node.trafficDown || 0);
    case "price":
      return ctx.priceByUuid.get(node.uuid) ?? 0;
    case "default":
    default:
      return node.weight;
  }
}

/**
 * 三段式排序:活跃 → 未达标 → 离线;只有"活跃段"按所选维度+方向排,其余两段一律 weight 升序兜底,
 * 保证稳定不跳。纯函数,不持有任何状态(实时网速的均值/活跃集由调用方算好后注入)。
 */
export function sortHomeNodes(
  nodes: HomeNodeSummary[],
  field: HomeSortField,
  direction: HomeSortDirection,
  ctx: HomeSortContext,
): HomeNodeSummary[] {
  const factor = direction === "asc" ? 1 : -1;
  // decorate-sort-undecorate:segment/primary/weight 每个节点只算一次,避免 comparator 里
  // 反复 segmentOf()/primaryValue() 的重复 Map 查找(节点多时更省)。
  return nodes
    .map((node) => ({
      node,
      segment: segmentOf(node, field, ctx),
      primary: primaryValue(node, field, ctx),
      weight: node.weight,
      uuid: node.uuid,
    }))
    .sort((a, b) => {
      if (a.segment !== b.segment) return a.segment - b.segment;

      if (a.segment === 0) {
        const cmp =
          typeof a.primary === "string" || typeof b.primary === "string"
            ? String(a.primary).localeCompare(String(b.primary), "zh-CN")
            : a.primary - b.primary;
        if (cmp !== 0) return cmp * factor;
      }

      // 未达标/离线段,或主键相等:按 weight 升序、再 uuid 兜底(方向不作用于兜底键,保证稳定)。
      if (a.weight !== b.weight) return a.weight - b.weight;
      return a.uuid.localeCompare(b.uuid);
    })
    .map((entry) => entry.node);
}

/**
 * 把冻结的速率排序(上次 5s 重排得到的 uuid 顺序)映射回当前节点,并按「当前」在线态即时重新
 * 分段:5s 间隔内掉线的节点立刻沉底,不等下一次 interval——保证「离线永远沉底」每帧都成立。
 * 在线节点保持冻结相对序;新出现、还没排进冻结序的节点临时挂各自段末尾,下个 tick 再归位。
 */
export function reconcileSpeedOrder(
  nodes: HomeNodeSummary[],
  frozenUuids: string[],
): HomeNodeSummary[] {
  const byUuid = new Map(nodes.map((node) => [node.uuid, node] as const));
  const online: HomeNodeSummary[] = [];
  const offline: HomeNodeSummary[] = [];
  const used = new Set<string>();
  const place = (node: HomeNodeSummary) => {
    (node.online === false ? offline : online).push(node);
    used.add(node.uuid);
  };
  for (const uuid of frozenUuids) {
    const node = byUuid.get(uuid);
    if (node) place(node);
  }
  for (const node of nodes) {
    if (!used.has(node.uuid)) place(node);
  }
  return [...online, ...offline];
}
