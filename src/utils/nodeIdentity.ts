import type { NodeInfo } from "@/types/komari";

// 节点身份匹配:用户在「忽略计费节点」「隐藏节点」里填的名称或 UUID,与节点的多个身份
// 字段做大小写无关比较。两处共用同一套字段清单与归一化,避免逻辑两地漂移。

export function normalizeNodeIdentityValue(value: unknown): string {
  return String(value == null ? "" : value).trim().toLowerCase();
}

// 把用户输入(字符串按换行/逗号/分号分隔,或已是数组)归一化成去重、去空的列表。
export function normalizeNodeIdentityList(value: unknown): string[] {
  const rawValues = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[\n,，;；]+/)
      : [];

  return Array.from(
    new Set(
      rawValues
        .map((item) =>
          typeof item === "string" || typeof item === "number" ? String(item).trim() : "",
        )
        .filter(Boolean),
    ),
  );
}

export function buildNodeIdentitySet(values: string[]): Set<string> {
  return new Set(values.map(normalizeNodeIdentityValue).filter(Boolean));
}

const IDENTITY_FIELDS = [
  "id",
  "uuid",
  "name",
  "display_name",
  "remark",
  "alias",
  "public_remark",
] as const;

// 节点的任一身份字段命中集合即视为匹配。
export function nodeMatchesIdentitySet(node: NodeInfo, identitySet: Set<string>): boolean {
  if (identitySet.size === 0) return false;
  const record = node as unknown as Record<string, unknown>;
  for (const field of IDENTITY_FIELDS) {
    const normalized = normalizeNodeIdentityValue(record[field]);
    if (normalized && identitySet.has(normalized)) return true;
  }
  return false;
}

// 从完整节点 meta 中收集命中身份列表的节点 UUID 集合。名称匹配需要完整 meta(摘要里没有
// name),所以在 allMeta 上算一次,结果按 uuid 应用到卡片摘要、总览、费用等各处。
// 列表为空时返回空集合(调用方据此跳过过滤,保持引用稳定、不触发额外重渲染)。
export function collectMatchingNodeUuids(nodes: NodeInfo[], identityList: string[]): Set<string> {
  const identitySet = buildNodeIdentitySet(identityList);
  const uuids = new Set<string>();
  if (identitySet.size === 0) return uuids;
  for (const node of nodes) {
    if (nodeMatchesIdentitySet(node, identitySet)) uuids.add(node.uuid);
  }
  return uuids;
}
