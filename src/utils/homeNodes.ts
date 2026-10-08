import type { HomeNodeSummary } from "@/services/wsStore";
import { getDisplayRegionCode, normalizeRegionCode } from "@/utils/geo";

export const HOME_ALL_GROUP = "__all__";
export const HOME_ALL_REGION = "__all__";

export interface HomeRegionOption {
  /** 展示地区代码(如 "US"),同时用作国旗输入与筛选键;无法识别的地区归入 "UN"。 */
  code: string;
  count: number;
}

// 默认地区排序优先级:中国大陆(CN)最前,港澳台紧随,再新加坡/日本/美国,然后欧洲诸国整体一档,
// 其余垫底。列表内每个代码有唯一名次,所以无论数量多少都固定这个顺序。
const REGION_PRIORITY: string[] = ["CN", "HK", "MO", "TW", "SG", "JP", "US"];

// 欧洲诸国(含跨洲但通常并入欧洲的 TR/RU/外高加索),统一排在优先列表之后、其余地区之前。
const EUROPE_CODES = new Set<string>([
  // "EU":geo.ts 会把 Europe/欧洲 解析成 EU,归入本档而非"其余"。
  "EU",
  "GB", "IE", "FR", "DE", "NL", "BE", "LU", "CH", "AT", "IT", "ES", "PT",
  "SE", "NO", "FI", "DK", "IS", "PL", "CZ", "SK", "HU", "RO", "BG", "GR",
  "HR", "SI", "RS", "BA", "ME", "MK", "AL", "LT", "LV", "EE", "UA", "MD",
  "BY", "RU", "TR", "CY", "MT", "LI", "MC", "AD", "SM", "VA", "GE", "AM", "AZ",
]);

function regionRank(code: string): number {
  const index = REGION_PRIORITY.indexOf(code);
  if (index !== -1) return index;
  if (EUROPE_CODES.has(code)) return REGION_PRIORITY.length;
  return REGION_PRIORITY.length + 1;
}

function compareDefaultRegionOptions(a: HomeRegionOption, b: HomeRegionOption): number {
  return regionRank(a.code) - regionRank(b.code) ||
    b.count - a.count ||
    a.code.localeCompare(b.code);
}

/**
 * 按展示地区代码聚合节点数,按固定地理优先级排序(见 REGION_PRIORITY):中国(大陆优先,含港澳台)
 * → 新加坡 → 日本 → 美国 → 欧洲诸国 → 其余。同一档内(欧洲/其余)再按数量降序、代码升序。
 * 已配置的地区优先按 order 排列，未配置的地区沿用默认规则追加。
 */
export function getHomeRegionOptions(
  nodes: ReadonlyArray<Pick<HomeNodeSummary, "region">>,
  order: readonly string[] = [],
): HomeRegionOption[] {
  const ranks = new Map(normalizeHomeRegionOrder(order).map((code, index) => [code, index]));
  const counts = new Map<string, number>();
  for (const node of nodes) {
    const code = getDisplayRegionCode(node.region);
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return Array.from(counts, ([code, count]) => ({ code, count })).sort(
    (a, b) =>
      (ranks.get(a.code) ?? ranks.size) - (ranks.get(b.code) ?? ranks.size) ||
      compareDefaultRegionOptions(a, b),
  );
}

/** 只保存有效地区代码，未知地区 UN 也可排序；忽略无效值并保留首次出现的顺序。 */
export function normalizeHomeRegionOrder(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const codes = value.flatMap((item) => {
    if (typeof item !== "string") return [];
    const normalized = normalizeRegionCode(item);
    return normalized ? [normalized] : [];
  });
  return [...new Set(codes)];
}

export function getHomeGroupLabel(group: string) {
  return group.trim();
}

/** 对一组原始 group 值做 trim、去空、去重,保留首次出现的顺序。 */
export function dedupeGroupLabels(groups: Iterable<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const raw of groups) {
    const label = getHomeGroupLabel(String(raw ?? ""));
    if (!label || seen.has(label)) continue;
    seen.add(label);
    result.push(label);
  }

  return result;
}

export function getHomeGroupOptions(nodes: HomeNodeSummary[]) {
  return dedupeGroupLabels(nodes.map((node) => node.group));
}

/** 规范化存下来的 group 排序:trim、去空、去重(首次出现的优先)。 */
export function normalizeHomeGroupOrder(value: unknown): string[] {
  return Array.isArray(value) ? dedupeGroupLabels(value as Array<string | null | undefined>) : [];
}

/** 保留缺席项的位置，用编辑后的可见顺序替换其余项，并追加新项。 */
export function mergeHomeOptionOrder(
  order: readonly string[],
  visibleOrder: readonly string[],
): string[] {
  const available = new Set(visibleOrder);
  const reordered = [...available];
  let index = 0;
  const merged = Array.from(new Set(order), (item) =>
    available.has(item) ? reordered[index++] : item,
  );
  return [...merged, ...reordered.slice(index)];
}

/**
 * 按用户配置的 `order` 给 `groups` 排序:仍存在的已配置 group 排在前面(按配置顺序),其余 group
 * 保持原本首次出现的顺序。没设排序时原样返回 `groups`。
 */
export function sortHomeGroupOptions(groups: string[], order: string[]): string[] {
  if (order.length === 0) return groups;

  const available = new Set(groups);
  const seen = new Set<string>();
  const result: string[] = [];

  for (const group of order) {
    if (available.has(group) && !seen.has(group)) {
      seen.add(group);
      result.push(group);
    }
  }
  for (const group of groups) {
    if (!seen.has(group)) {
      seen.add(group);
      result.push(group);
    }
  }

  return result;
}
