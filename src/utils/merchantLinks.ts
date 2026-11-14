export interface NodeMerchantLink {
  url: string;
  iconUrl: string;
}

export type NodeMerchantLinks = Record<string, NodeMerchantLink>;

/**
 * 商家链接由站长手动配置；这里只归一化存储形状与首尾空白。
 */
export function normalizeNodeMerchantLinks(value: unknown): NodeMerchantLinks {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const normalized: NodeMerchantLinks = {};
  for (const [rawUuid, rawLink] of Object.entries(value)) {
    const uuid = rawUuid.trim();
    if (!uuid || !rawLink || typeof rawLink !== "object" || Array.isArray(rawLink)) continue;

    const candidate = rawLink as Record<string, unknown>;
    const url = typeof candidate.url === "string" ? candidate.url.trim() : "";
    const iconUrl = typeof candidate.iconUrl === "string" ? candidate.iconUrl.trim() : "";
    if (!url && !iconUrl) continue;
    normalized[uuid] = { url, iconUrl };
  }
  return normalized;
}
