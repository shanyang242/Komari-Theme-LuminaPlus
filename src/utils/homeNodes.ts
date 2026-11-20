import type { HomeNodeSummary } from "@/services/wsStore";
import { getDisplayRegionCode } from "@/utils/geo";

export const HOME_ALL_GROUP = "__all__";
export const HOME_ALL_REGION = "__all__";

export interface HomeRegionOption {
  code: string;
  count: number;
}

// 地区排序优先级：优先列表 → 欧洲 → 其余
const REGION_PRIORITY: string[] = ["CN", "HK", "MO", "TW", "SG", "JP", "US"];

const EUROPE_CODES = new Set<string>([
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

export function getHomeRegionOptions(
  nodes: ReadonlyArray<Pick<HomeNodeSummary, "region">>,
): HomeRegionOption[] {
  const counts = new Map<string, number>();
  for (const node of nodes) {
    const code = getDisplayRegionCode(node.region);
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return Array.from(counts, ([code, count]) => ({ code, count })).sort(
    (a, b) =>
      regionRank(a.code) - regionRank(b.code) ||
      b.count - a.count ||
      a.code.localeCompare(b.code),
  );
}

export function getHomeGroupLabel(group: string) {
  return group.trim();
}

function dedupeGroupLabels(groups: Iterable<string | null | undefined>): string[] {
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

export function getHomeGroupOptions(
  nodes: ReadonlyArray<Pick<HomeNodeSummary, "group">>,
) {
  return dedupeGroupLabels(nodes.map((node) => node.group));
}

export function moveOfflineHomeNodesLast<T extends Pick<HomeNodeSummary, "online">>(
  nodes: readonly T[],
): T[] {
  const available: T[] = [];
  const offline: T[] = [];
  for (const node of nodes) {
    (node.online === false ? offline : available).push(node);
  }
  return [...available, ...offline];
}
