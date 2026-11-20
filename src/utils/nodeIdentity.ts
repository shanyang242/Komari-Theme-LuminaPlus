import type { NodeInfo } from "@/types/komari";

function normalizeNodeIdentityValue(value: unknown): string {
  return String(value == null ? "" : value).trim().toLowerCase();
}

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

export function nodeMatchesIdentitySet(node: NodeInfo, identitySet: Set<string>): boolean {
  if (identitySet.size === 0) return false;
  const record = node as unknown as Record<string, unknown>;
  for (const field of IDENTITY_FIELDS) {
    const normalized = normalizeNodeIdentityValue(record[field]);
    if (normalized && identitySet.has(normalized)) return true;
  }
  return false;
}

export function collectMatchingNodeUuids(nodes: NodeInfo[], identityList: string[]): Set<string> {
  const identitySet = buildNodeIdentitySet(identityList);
  const uuids = new Set<string>();
  if (identitySet.size === 0) return uuids;
  for (const node of nodes) {
    if (nodeMatchesIdentitySet(node, identitySet)) uuids.add(node.uuid);
  }
  return uuids;
}
