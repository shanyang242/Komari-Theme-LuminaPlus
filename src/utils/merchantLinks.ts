export interface NodeMerchantLink {
  url: string;
  iconUrl: string;
}

export type NodeMerchantLinks = Record<string, NodeMerchantLink>;

const MAX_MERCHANT_URL_LENGTH = 2048;
const CONTROL_CHARS_RE = new RegExp("[\\x00-\\x1f\\x7f]");
const EXPLICIT_SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

/** 商家官网地址仅允许 http(s) 协议，阻断 javascript:/data:/vbscript: 等危险协议。 */
export function sanitizeMerchantUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_MERCHANT_URL_LENGTH || CONTROL_CHARS_RE.test(trimmed)) {
    return "";
  }
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? trimmed : "";
  } catch {
    return "";
  }
}

/** 商家图标允许 http(s) 外链或站内相对路径，同时过滤危险协议与 protocol-relative 路径。 */
export function sanitizeMerchantIconUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_MERCHANT_URL_LENGTH || CONTROL_CHARS_RE.test(trimmed)) {
    return "";
  }
  if (trimmed.startsWith("//") || trimmed.startsWith("/\\") || trimmed.startsWith("\\")) {
    return "";
  }
  if (EXPLICIT_SCHEME_RE.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      return parsed.protocol === "http:" || parsed.protocol === "https:" ? trimmed : "";
    } catch {
      return "";
    }
  }
  return trimmed;
}

export function getMerchantLinkErrors(link: NodeMerchantLink) {
  return {
    url: link.url.trim() && !sanitizeMerchantUrl(link.url)
      ? "请输入以 http:// 或 https:// 开头的完整商家网址"
      : null,
    iconUrl: link.iconUrl.trim() && !sanitizeMerchantIconUrl(link.iconUrl)
      ? "请输入 HTTP(S) 图片地址或站内路径，不支持 // 地址或内联图片"
      : null,
  };
}

export function hasInvalidMerchantLinks(links: NodeMerchantLinks): boolean {
  return Object.values(links).some((link) => {
    const errors = getMerchantLinkErrors(link);
    return Boolean(errors.url || errors.iconUrl);
  });
}

/**
 * 商家链接由站长手动配置；归一化存储形状并过滤危险协议。
 */
export function normalizeNodeMerchantLinks(value: unknown): NodeMerchantLinks {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const normalized: NodeMerchantLinks = {};
  for (const [rawUuid, rawLink] of Object.entries(value)) {
    const uuid = rawUuid.trim();
    if (!uuid || !rawLink || typeof rawLink !== "object" || Array.isArray(rawLink)) continue;

    const candidate = rawLink as Record<string, unknown>;
    const url = sanitizeMerchantUrl(candidate.url);
    const iconUrl = sanitizeMerchantIconUrl(candidate.iconUrl);
    if (!url && !iconUrl) continue;
    normalized[uuid] = { url, iconUrl };
  }
  return normalized;
}
