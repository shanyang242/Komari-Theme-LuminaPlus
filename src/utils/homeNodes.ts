import type { HomeNodeSummary } from "@/services/wsStore";

export const HOME_ALL_GROUP = "__all__";

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
