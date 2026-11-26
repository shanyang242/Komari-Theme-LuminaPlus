import type { HomeNodeSummary } from "@/services/wsStore";

// 首页临时排序；默认使用后端 weight，离线节点始终沉底。

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

/** 需要高频实时摘要（瞬时速率 / 累计流量）的排序维度。 */
export function sortFieldNeedsLiveSummaries(field: HomeSortField): boolean {
  return field === "speed" || field === "traffic";
}

// 速率排序使用 0.5/0.3 MB/s 进出滞回门，避免节点反复换位。
export const HOME_SPEED_ENTER_BPS = 0.5 * 1024 * 1024;
export const HOME_SPEED_EXIT_BPS = 0.3 * 1024 * 1024;
export const HOME_SPEED_SAMPLE_WINDOW = 3;
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

// 0=参与排序，1=无有效排序值，2=离线；后两段按 weight 排列。
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

/** 三段式稳定排序，实时速率状态由调用方注入。 */
export function sortHomeNodes(
  nodes: HomeNodeSummary[],
  field: HomeSortField,
  direction: HomeSortDirection,
  ctx: HomeSortContext,
): HomeNodeSummary[] {
  const factor = direction === "asc" ? 1 : -1;
  // 预计算比较键，避免 comparator 重复查 Map。
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

      // 兜底键不受方向影响，保持顺序稳定。
      if (a.weight !== b.weight) return a.weight - b.weight;
      return a.uuid.localeCompare(b.uuid);
    })
    .map((entry) => entry.node);
}

/** 恢复冻结顺序，同时让新离线节点立即沉底。 */
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
