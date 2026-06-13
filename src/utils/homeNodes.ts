import type { HomeNodeSummary } from "@/services/wsStore";

export const HOME_ALL_GROUP = "__all__";

export function getHomeGroupLabel(group: string) {
  return group.trim();
}

/** Trim, drop empties, and dedupe a list of raw group values, keeping first-seen order. */
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

/** Normalize a stored group order: trim, drop empties, dedupe (first-seen wins). */
export function normalizeHomeGroupOrder(value: unknown): string[] {
  return Array.isArray(value) ? dedupeGroupLabels(value as Array<string | null | undefined>) : [];
}

/**
 * Order `groups` by the user-configured `order`: configured groups that still
 * exist come first (in the configured order), then any remaining groups keep
 * their original first-seen order. Returns `groups` unchanged when no order is set.
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

export function sortHomeNodeSummaries(
  nodes: HomeNodeSummary[],
  moveOfflineNodesBack: boolean,
) {
  if (!moveOfflineNodesBack) return nodes;
  return [...nodes].sort((left, right) => {
    const leftOffline = left.online === false ? 1 : 0;
    const rightOffline = right.online === false ? 1 : 0;
    if (leftOffline !== rightOffline) return leftOffline - rightOffline;
    if (left.weight !== right.weight) return left.weight - right.weight;
    return left.uuid.localeCompare(right.uuid);
  });
}
