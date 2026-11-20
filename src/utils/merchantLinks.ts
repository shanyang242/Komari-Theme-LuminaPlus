export interface NodeMerchantLink {
  url: string;
  iconUrl: string;
}

export type NodeMerchantLinks = Record<string, NodeMerchantLink>;

const UNSAFE_OR_WHITESPACE_RE = /[\x00-\x1f\x7f\s]/;
const SCHEME_PREFIX_RE = /^([a-zA-Z][a-zA-Z\d+.-]*):(.*)$/;
const HOST_PORT_REST_RE = /^\d{1,5}(?:[/?#]|$)/;
const IPV4_HOST_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const DOMAIN_HOST_RE =
  /^(?:[a-zA-Z\d\u00a1-\uffff](?:[a-zA-Z\d\u00a1-\uffff-]*[a-zA-Z\d\u00a1-\uffff])?\.)+(?:[a-zA-Z\u00a1-\uffff]{2,}|xn--[a-zA-Z\d-]+)$/;
const MISSING_COLON_HTTP_TYPO_RE = /^https?(?:\/|$)/i;

function isSafeHttpUrl(value: string): boolean {
  try {
    const { protocol, hostname, port } = new URL(value);
    if (protocol !== "http:" && protocol !== "https:") return false;
    if (!hostname) return false;
    if (port !== "") {
      const portNum = Number(port);
      if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65_535) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function isBareHostCandidate(value: string): boolean {
  const authority = value.split(/[/?#]/, 1)[0] ?? "";
  if (!authority) return false;

  if (authority.startsWith("[")) {
    return /^\[[0-9a-fA-F:]+\](?::\d{1,5})?$/.test(authority);
  }

  const host = authority.replace(/:\d{1,5}$/, "");
  if (!host) return false;
  if (host.toLowerCase() === "localhost") return true;
  if (IPV4_HOST_RE.test(host)) return true;
  return DOMAIN_HOST_RE.test(host);
}

/** 校验商家链接：允许 http(s)、站内路径及裸域名（补 https://），阻断伪协议。 */
export function resolveMerchantLinkUrl(raw: string | null | undefined): string {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed || UNSAFE_OR_WHITESPACE_RE.test(trimmed)) return "";
  if (trimmed.startsWith("://")) return "";

  if (trimmed.startsWith("//")) {
    const candidate = `https:${trimmed}`;
    return isSafeHttpUrl(candidate) ? candidate : "";
  }

  if (
    trimmed.startsWith("/") ||
    trimmed.startsWith("./") ||
    trimmed.startsWith("../")
  ) {
    return trimmed;
  }

  const schemeMatch = SCHEME_PREFIX_RE.exec(trimmed);
  if (schemeMatch) {
    const [, prefix, rest] = schemeMatch;
    const lowerPrefix = prefix.toLowerCase();
    if (lowerPrefix === "http" || lowerPrefix === "https") {
      return /^https?:\/\//i.test(trimmed) && isSafeHttpUrl(trimmed) ? trimmed : "";
    }
    // 区分协议头与 host:port
    const isHostWithPort =
      HOST_PORT_REST_RE.test(rest) &&
      (lowerPrefix === "localhost" || prefix.includes("."));
    if (!isHostWithPort) {
      return "";
    }
  }

  if (isBareHostCandidate(trimmed)) {
    const candidate = `https://${trimmed}`;
    return isSafeHttpUrl(candidate) ? candidate : "";
  }

  return "";
}

/** 校验商家图标：允许 http(s)、// 及站内相对路径，阻断伪协议。 */
export function resolveMerchantIconUrl(raw: string | null | undefined): string {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed || UNSAFE_OR_WHITESPACE_RE.test(trimmed)) return "";
  if (trimmed.startsWith("://") || MISSING_COLON_HTTP_TYPO_RE.test(trimmed)) return "";

  if (trimmed.startsWith("//")) {
    const candidate = `https:${trimmed}`;
    return isSafeHttpUrl(candidate) ? candidate : "";
  }

  if (
    trimmed.startsWith("/") ||
    trimmed.startsWith("./") ||
    trimmed.startsWith("../")
  ) {
    return trimmed;
  }

  const schemeMatch = SCHEME_PREFIX_RE.exec(trimmed);
  if (schemeMatch) {
    const [, prefix, rest] = schemeMatch;
    const lowerPrefix = prefix.toLowerCase();
    if (lowerPrefix === "http" || lowerPrefix === "https") {
      return /^https?:\/\//i.test(trimmed) && isSafeHttpUrl(trimmed) ? trimmed : "";
    }
    const isHostWithPort =
      HOST_PORT_REST_RE.test(rest) &&
      (lowerPrefix === "localhost" || prefix.includes("."));
    if (isHostWithPort && isBareHostCandidate(trimmed)) {
      const candidate = `https://${trimmed}`;
      return isSafeHttpUrl(candidate) ? candidate : "";
    }
    return "";
  }

  // 其余无协议头路径按同源相对资源放行
  return trimmed;
}

export function getMerchantLinkValidationErrors(
  link: Partial<NodeMerchantLink> | null | undefined,
): {
  urlError: string | null;
  iconUrlError: string | null;
} {
  const rawUrl = link?.url?.trim() ?? "";
  const rawIconUrl = link?.iconUrl?.trim() ?? "";
  return {
    urlError:
      rawUrl !== "" && !resolveMerchantLinkUrl(rawUrl)
        ? "请输入有效的 http(s) 网址、域名（支持端口）或以 / 开头的路径"
        : null,
    iconUrlError:
      rawIconUrl !== "" && !resolveMerchantIconUrl(rawIconUrl)
        ? "请输入有效的 http(s) 图标地址或站内相对路径"
        : null,
  };
}

export function hasInvalidNodeMerchantLinks(links: NodeMerchantLinks): boolean {
  for (const link of Object.values(links)) {
    const { urlError, iconUrlError } = getMerchantLinkValidationErrors(link);
    if (urlError || iconUrlError) return true;
  }
  return false;
}

/** 读取编辑器草稿，保留非法原始值以便与主动清空区分。 */
export function readRawNodeMerchantLinks(value: unknown): NodeMerchantLinks {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const result: NodeMerchantLinks = {};
  for (const [rawUuid, rawLink] of Object.entries(value)) {
    const uuid = rawUuid.trim();
    if (!uuid || !rawLink || typeof rawLink !== "object" || Array.isArray(rawLink)) continue;
    const candidate = rawLink as Record<string, unknown>;
    const rawUrl = typeof candidate.url === "string" ? candidate.url.trim() : "";
    const rawIconUrl = typeof candidate.iconUrl === "string" ? candidate.iconUrl.trim() : "";
    if (!rawUrl && !rawIconUrl) continue;
    result[uuid] = {
      url: resolveMerchantLinkUrl(rawUrl) || rawUrl,
      iconUrl: resolveMerchantIconUrl(rawIconUrl) || rawIconUrl,
    };
  }
  return result;
}

export function normalizeNodeMerchantLinks(value: unknown): NodeMerchantLinks {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const normalized: NodeMerchantLinks = {};
  for (const [rawUuid, rawLink] of Object.entries(value)) {
    const uuid = rawUuid.trim();
    if (!uuid || !rawLink || typeof rawLink !== "object" || Array.isArray(rawLink)) continue;

    const candidate = rawLink as Record<string, unknown>;
    const url = typeof candidate.url === "string" ? resolveMerchantLinkUrl(candidate.url) : "";
    const iconUrl =
      typeof candidate.iconUrl === "string" ? resolveMerchantIconUrl(candidate.iconUrl) : "";
    if (!url && !iconUrl) continue;
    normalized[uuid] = { url, iconUrl };
  }
  return normalized;
}
