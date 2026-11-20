import type { NodeInfo } from "@/types/komari";
import { normalizeBillingCycle } from "@/utils/billing";
import { fetchWithTimeout } from "@/utils/abort";
import { resolveExpireTimestamp } from "@/utils/format";
import { buildNodeIdentitySet, nodeMatchesIdentitySet, normalizeNodeIdentityList } from "@/utils/nodeIdentity";

const COST_TARGET_CURRENCY = "CNY";
export const DEFAULT_COST_RATE_API_URL = "https://api.frankfurter.dev/v2/rates?base=USD";
const RATE_CACHE_TTL_MS = 60 * 60 * 1000;
const RATE_CACHE_KEY_PREFIX = "lumina-plus:cost-rates:";
const RATE_REQUEST_TIMEOUT_MS = 10_000;

const CURRENCY_ALIASES: Record<string, string> = {
  "$": "USD",
  "US$": "USD",
  "$US": "USD",
  "USD$": "USD",
  "$USD": "USD",
  USD: "USD",
  "美元": "USD",
  "美金": "USD",
  "€": "EUR",
  EUR: "EUR",
  "欧元": "EUR",
  "￥": "CNY",
  "¥": "CNY",
  CNY: "CNY",
  RMB: "CNY",
  "CN¥": "CNY",
  "人民币": "CNY",
  "元": "CNY",
  "HK$": "HKD",
  HKD: "HKD",
  "港币": "HKD",
  "港元": "HKD",
  "NT$": "TWD",
  TWD: "TWD",
  "台币": "TWD",
  "新台币": "TWD",
  JPY: "JPY",
  "JP¥": "JPY",
  "日元": "JPY",
  "円": "JPY",
  "£": "GBP",
  GBP: "GBP",
  "英镑": "GBP",
  "S$": "SGD",
  SGD: "SGD",
  "新币": "SGD",
  "新加坡元": "SGD",
  "A$": "AUD",
  "AU$": "AUD",
  AUD: "AUD",
  "澳元": "AUD",
  "C$": "CAD",
  "CA$": "CAD",
  CAD: "CAD",
  "加元": "CAD",
};

interface CostSummary {
  totalCny: number;
  monthlyCny: number;
  remainingCny: number;
  // 独立统计，不计入 remainingCny / totalCny / monthlyCny
  premiumTotalCny: number;
  premiumMonthlyTotalCny: number;
  premiumRemainingTotalCny: number;
  effectiveMonthlyCny: number;
  actualRemainingCny: number;
  details: CostSummaryDetail[];
}

interface CostPaybackResult {
  status: "unconfigured" | "impossible" | "active" | "recovered";
  remainingDays: number | null;
  remainingCny: number;
  netCny: number;
}

interface CostSummaryDetail {
  uuid: string;
  name: string;
  region: string;
  expiredAt: string;
  weight: number;
  priceCny: number;
  monthlyCny: number;
  remainingCny: number;
  premiumCny: number;
  regularPriceCny: number | null;
  payback: CostPaybackResult;
  amortMonths: number | null;
  premiumMonthlyCny: number;
  premiumRemainingCny: number;
  billingCycleDays: number;
  counted: boolean;
  billingIgnored: boolean;
  note: string;
}

interface ExchangeRateData {
  rates: Record<string, number>;
  time: number;
}

type CostNode = NodeInfo & Record<string, unknown>;

export const normalizeCostIgnoredNodes = normalizeNodeIdentityList;

export interface CostPremiumEntry {
  amount: number;
  paidCny?: number;
  acquiredAt?: string;
  regularPriceCny?: number;
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseLocalDateKey(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(year, month - 1, day);
  return parsed.getFullYear() === year &&
    parsed.getMonth() === month - 1 &&
    parsed.getDate() === day
    ? parsed.getTime()
    : null;
}

function parseAcquiredTimestamp(value: string) {
  const localDate = parseLocalDateKey(value);
  if (localDate != null) return localDate;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeAcquiredAt(value: unknown) {
  const raw = typeof value === "string" ? value.trim() : "";
  return parseLocalDateKey(raw) != null && raw <= localDateKey() ? raw : undefined;
}

// 非法字段丢弃；仅溢价为 0 且无收购价时丢弃整条
export function normalizeCostPremiums(value: unknown): Record<string, CostPremiumEntry> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const result: Record<string, CostPremiumEntry> = {};
  for (const [uuid, raw] of Object.entries(value as Record<string, unknown>)) {
    const key = uuid.trim();
    if (!key) continue;

    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;

    const entry = raw as Record<string, unknown>;
    let amount = Number(entry.amount);
    let paidCny: number | undefined;
    let regularPriceCny: number | undefined;
    const rawPaid = Number(entry.paidCny);
    if (entry.paidCny != null && Number.isFinite(rawPaid) && rawPaid >= 0) paidCny = rawPaid;
    const acquiredAt = normalizeAcquiredAt(entry.acquiredAt);
    const rawRegularPrice = Number(entry.regularPriceCny);
    if (
      entry.regularPriceCny != null &&
      Number.isFinite(rawRegularPrice) &&
      rawRegularPrice >= 0
    ) {
      regularPriceCny = rawRegularPrice;
    }

    if (!Number.isFinite(amount)) amount = 0;
    if (amount === 0 && paidCny == null) continue;
    result[key] = {
      amount,
      ...(paidCny != null ? { paidCny } : {}),
      ...(acquiredAt ? { acquiredAt } : {}),
      ...(regularPriceCny != null ? { regularPriceCny } : {}),
    };
  }
  return result;
}

/** 有 current 时沿用已固化基准；改收购日期时省略 current 以新基准重算。 */
export function calculateCostPremiumAmount(
  paidCny: number,
  currentRemainingCny: number,
  current?: CostPremiumEntry,
) {
  const storedBasis =
    current?.paidCny != null ? current.paidCny - current.amount : Number.NaN;
  const basis = Number.isFinite(storedBasis) ? storedBasis : currentRemainingCny;
  return Math.round((paidCny - basis) * 100) / 100;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const AMORT_MONTH_MS = 30 * DAY_MS;
const AMORT_LONG_TERM_MS = 100 * 365 * 24 * 60 * 60 * 1000;

// 优先按收购日至到期日摊销，长期或无到期时回退已持有时长
function premiumAmortMonths(
  acquiredAt: string | undefined,
  expiredAt: string | number | null | undefined,
  now: number,
): number | null {
  if (!acquiredAt) return null;
  const acquiredMs = parseAcquiredTimestamp(acquiredAt);
  if (acquiredMs == null || acquiredMs > now) return null;

  const expiresMs = resolveExpireTimestamp(expiredAt);
  const span =
    expiresMs != null && expiresMs > acquiredMs && expiresMs - acquiredMs < AMORT_LONG_TERM_MS
      ? expiresMs - acquiredMs
      : now - acquiredMs;
  return Math.max(1, span / AMORT_MONTH_MS);
}

function premiumRemainingValue(
  premium: number,
  acquiredAt: string | undefined,
  expiredAt: string | number | null | undefined,
  now: number,
) {
  if (premium === 0) return 0;
  const expiresMs = resolveExpireTimestamp(expiredAt);
  if (expiresMs == null || expiresMs - now >= AMORT_LONG_TERM_MS) return premium;
  if (expiresMs <= now) return 0;

  const acquiredMs = acquiredAt ? parseAcquiredTimestamp(acquiredAt) : null;
  if (
    acquiredMs == null ||
    acquiredMs > now ||
    acquiredMs >= expiresMs ||
    expiresMs - acquiredMs >= AMORT_LONG_TERM_MS
  ) {
    return premium;
  }

  const remainingRatio = Math.min(
    1,
    Math.max(0, (expiresMs - now) / (expiresMs - acquiredMs)),
  );
  return premium * remainingRatio;
}

export function isCostRateApiUrlValid(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

export function normalizeCostRateApiUrl(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  return raw && isCostRateApiUrlValid(raw) ? raw : DEFAULT_COST_RATE_API_URL;
}

function currencyCode(value: unknown) {
  const raw = String(value ?? "").trim();
  // 未设货币默认按 CNY，避免误乘 USD 汇率
  if (!raw) return COST_TARGET_CURRENCY;

  const key = raw.toUpperCase().replace(/\s+/g, "").replace("＄", "$");
  return CURRENCY_ALIASES[key] || (/^[A-Z]{3}$/.test(key) ? key : "");
}

function billingCycleDays(value: unknown): number {
  return normalizeBillingCycle(value as string | number | null | undefined).days;
}

function cycleMonths(days: number) {
  if (days === 365 || days === 360) return 12;
  if (days === 30) return 1;
  // 整年倍数按 /365 精确年化，避免 /30 偏差
  if (days > 0 && days % 365 === 0) return (days / 365) * 12;
  if (days > 0) return days / 30;
  return 0;
}

export function calculateCostPayback(
  premiumCny: number,
  renewalPriceCny: number,
  regularPriceCny: number | undefined,
  cycleDays: number,
  acquiredAt?: string,
  now = Date.now(),
  expiredAt?: string | number | null,
): CostPaybackResult {
  const immediateNet = Math.max(0, -premiumCny);
  if (regularPriceCny == null) {
    return premiumCny <= 0
      ? { status: "recovered", remainingDays: 0, remainingCny: 0, netCny: immediateNet }
      : { status: "unconfigured", remainingDays: null, remainingCny: premiumCny, netCny: 0 };
  }
  const savingsPerCycle = regularPriceCny - renewalPriceCny;
  const daysPerCycle = cycleDays === 360 ? 365 : cycleDays;
  if (savingsPerCycle <= 0 || daysPerCycle <= 0) {
    return premiumCny <= 0
      ? { status: "recovered", remainingDays: 0, remainingCny: 0, netCny: immediateNet }
      : { status: "impossible", remainingDays: null, remainingCny: premiumCny, netCny: 0 };
  }

  const acquiredMs = acquiredAt ? parseAcquiredTimestamp(acquiredAt) : null;
  const expiresMs = resolveExpireTimestamp(expiredAt);
  const heldUntil = expiresMs != null && expiresMs < now ? expiresMs : now;
  const elapsedDays = acquiredMs == null
    ? 0
    : Math.floor(Math.max(0, (heldUntil - acquiredMs) / DAY_MS));
  const savingsPerDay = savingsPerCycle / daysPerCycle;
  const recoveredCny = savingsPerDay * elapsedDays;
  const remainingCny = Math.max(0, premiumCny - recoveredCny);
  const netCny = Math.max(0, recoveredCny - premiumCny);
  const remainingDays = remainingCny / savingsPerDay;
  return {
    status: remainingCny > 0 ? "active" : "recovered",
    remainingDays,
    remainingCny,
    netCny,
  };
}

export function formatCostPayback(payback: CostPaybackResult) {
  if (payback.status === "unconfigured") return "—";
  if (payback.status === "impossible") return "无法回本";
  if (payback.status === "recovered") {
    return payback.netCny >= 0.005
      ? `已回本净省${payback.netCny.toFixed(2)}`
      : "已回本";
  }
  return `待回本${payback.remainingCny.toFixed(2)}还需${Math.ceil(payback.remainingDays ?? 0)}天`;
}

function remainingCycleValue(
  price: number,
  cycleDays: number,
  expiredAt: string | number | null | undefined,
  atMs: number = Date.now(),
) {
  const expiresMs = resolveExpireTimestamp(expiredAt);
  // 无到期或超百年（永久/买断）按单周期价值计
  if (expiresMs == null) return price;

  const diffMs = expiresMs - atMs;
  if (diffMs <= 0) return 0;

  const diffYears = diffMs / (1000 * 60 * 60 * 24 * 365);
  if (diffYears > 100) return price;

  if (cycleDays > 0) {
    // 按剩余周期数折算预付价值，不设上限
    return price * (diffMs / (cycleDays * 24 * 60 * 60 * 1000));
  }

  return price;
}

export function formatSignedCny(value: number) {
  const sign = value < 0 ? "-" : "+";
  return `${sign}${formatCnyMoney(Math.abs(value))}`;
}

function readRateCache(cacheKey: string, allowExpired = false): ExchangeRateData | null {
  try {
    const cached = JSON.parse(localStorage.getItem(cacheKey) || "null") as unknown;
    if (!cached || typeof cached !== "object" || Array.isArray(cached)) return null;
    const record = cached as Record<string, unknown>;
    const time = typeof record.time === "number" ? record.time : Number.NaN;
    const age = Date.now() - time;
    if (!Number.isFinite(time) || age < 0 || (!allowExpired && age >= RATE_CACHE_TTL_MS)) {
      return null;
    }
    return { ...parseRatePayload(record), time };
  } catch {
    return null;
  }
}

function writeRateCache(cacheKey: string, data: ExchangeRateData) {
  try {
    localStorage.setItem(cacheKey, JSON.stringify(data));
  } catch {
    // 忽略存储异常
  }
}

function parseRatePayload(payload: unknown): Pick<ExchangeRateData, "rates"> {
  const rates: Record<string, number> = { USD: 1 };

  if (Array.isArray(payload)) {
    for (const item of payload) {
      const record = item && typeof item === "object" ? (item as Record<string, unknown>) : null;
      const quote = record?.quote;
      const rate = Number(record?.rate);
      if (typeof quote === "string" && Number.isFinite(rate) && rate > 0) {
        rates[quote.toUpperCase()] = rate;
      }
    }
  } else if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    const rawRates = record.rates;
    if (rawRates && typeof rawRates === "object") {
      for (const [key, value] of Object.entries(rawRates)) {
        const rate = Number(value);
        if (Number.isFinite(rate) && rate > 0) {
          rates[key.toUpperCase()] = rate;
        }
      }
    }
  }

  if (!rates[COST_TARGET_CURRENCY]) {
    throw new Error("target rate missing");
  }

  return { rates };
}

interface ExchangeRateRequestOptions {
  signal?: AbortSignal;
  ignoreCache?: boolean;
}

export async function getExchangeRates(
  rateApiUrl: string,
  options: ExchangeRateRequestOptions = {},
): Promise<ExchangeRateData> {
  const cacheKey = `${RATE_CACHE_KEY_PREFIX}${rateApiUrl}`;
  const cached = options.ignoreCache ? null : readRateCache(cacheKey);
  if (cached) return cached;

  try {
    const response = await fetchWithTimeout(
      rateApiUrl,
      { cache: "no-store", signal: options.signal },
      RATE_REQUEST_TIMEOUT_MS,
    );
    if (!response.ok) {
      throw new Error(`rate http ${response.status}`);
    }

    const parsed = parseRatePayload(await response.json());
    const data: ExchangeRateData = {
      ...parsed,
      time: Date.now(),
    };
    writeRateCache(cacheKey, data);
    return data;
  } catch (error) {
    if (options.signal?.aborted) throw error;
    const old = readRateCache(cacheKey, true);
    if (old) {
      return old;
    }
    throw error;
  }
}

function convertToCny(
  amount: number,
  currency: unknown,
  rates: Record<string, number>,
) {
  const code = currencyCode(currency);
  if (!code) return null;
  if (code === COST_TARGET_CURRENCY) return amount;
  if (!rates[code] || !rates[COST_TARGET_CURRENCY]) return null;
  return (amount / rates[code]) * rates[COST_TARGET_CURRENCY];
}

export function calculateCostSummary(
  nodes: NodeInfo[],
  ignoredNodes: string[],
  rates: Record<string, number>,
  premiums: Record<string, CostPremiumEntry> = {},
  now = Date.now(),
): CostSummary {
  let totalCny = 0;
  let monthlyCny = 0;
  let remainingCny = 0;
  let premiumTotalCny = 0;
  let premiumMonthlyTotalCny = 0;
  let premiumRemainingTotalCny = 0;
  const details: CostSummaryDetail[] = [];
  const ignored = buildNodeIdentitySet(ignoredNodes);
  for (const node of nodes as CostNode[]) {
    const name = node.name || node.display_name || node.remark || node.uuid;
    const cycleDays = billingCycleDays(node.billing_cycle);
    const billingIgnored = nodeMatchesIdentitySet(node, ignored);
    // 溢价以 CNY 独立计入汇总（忽略节点除外），不依赖价格与汇率
    const entry = premiums[node.uuid];
    const premium = entry?.amount ?? 0;
    const regularPrice = entry?.regularPriceCny;
    const amortMonths =
      premium !== 0 ? premiumAmortMonths(entry?.acquiredAt, node.expired_at, now) : null;
    const premiumMonthly = amortMonths != null ? premium / amortMonths : 0;
    const premiumRemaining = premiumRemainingValue(
      premium,
      entry?.acquiredAt,
      node.expired_at,
      now,
    );
    const baseDetail = {
      uuid: node.uuid,
      name: String(name || "未命名服务器"),
      region: String(node.region || ""),
      expiredAt: String(node.expired_at || ""),
      weight: Number(node.weight) || 0,
      priceCny: 0,
      monthlyCny: 0,
      remainingCny: 0,
      premiumCny: premium,
      regularPriceCny: regularPrice ?? null,
      payback: calculateCostPayback(premium, 0, undefined, cycleDays),
      amortMonths,
      premiumMonthlyCny: premiumMonthly,
      premiumRemainingCny: premiumRemaining,
      billingCycleDays: cycleDays,
      billingIgnored,
    };

    const price = Number(node.price) || 0;
    if (price <= 0) {
      if (!billingIgnored) {
        premiumTotalCny += premium;
        premiumMonthlyTotalCny += premiumMonthly;
        premiumRemainingTotalCny += premiumRemaining;
      }
      details.push({
        ...baseDetail,
        payback: calculateCostPayback(
          premium,
          0,
          regularPrice,
          cycleDays,
          entry?.acquiredAt,
          now,
          node.expired_at,
        ),
        counted: false,
        note: "免费",
      });
      continue;
    }

    const converted = convertToCny(price, node.currency, rates);
    if (converted == null || !Number.isFinite(converted)) {
      if (!billingIgnored) {
        premiumTotalCny += premium;
        premiumMonthlyTotalCny += premiumMonthly;
        premiumRemainingTotalCny += premiumRemaining;
      }
      details.push({
        ...baseDetail,
        counted: false,
        note: "汇率缺失",
      });
      continue;
    }

    const months = cycleMonths(cycleDays);
    const monthly = months > 0 ? converted / months : 0;
    const remaining = remainingCycleValue(converted, cycleDays, node.expired_at, now);

    // totalCny 为年化周期支出（月度 ×12），永久节点不计入
    if (!billingIgnored) {
      totalCny += monthly * 12;
      monthlyCny += monthly;
      remainingCny += remaining;
      premiumTotalCny += premium;
      premiumMonthlyTotalCny += premiumMonthly;
      premiumRemainingTotalCny += premiumRemaining;
    }

    details.push({
      ...baseDetail,
      priceCny: converted,
      payback: calculateCostPayback(
        premium,
        converted,
        regularPrice,
        cycleDays,
        entry?.acquiredAt,
        now,
        node.expired_at,
      ),
      monthlyCny: monthly,
      remainingCny: remaining,
      counted: !billingIgnored,
      note: "",
    });
  }

  return {
    totalCny,
    monthlyCny,
    remainingCny,
    premiumTotalCny,
    premiumMonthlyTotalCny,
    premiumRemainingTotalCny,
    effectiveMonthlyCny: monthlyCny + premiumMonthlyTotalCny,
    actualRemainingCny: remainingCny + premiumRemainingTotalCny,
    details: details.sort(
      (a, b) => a.weight - b.weight || a.name.localeCompare(b.name, "zh-CN"),
    ),
  };
}

/** 按当前配置回算收购日的剩余价值，仅用于固化溢价基准。 */
export function calculateCostPremiumBasisAt(
  nodes: NodeInfo[],
  ignoredNodes: string[],
  rates: Record<string, number>,
  uuid: string,
  acquiredAt?: string,
  now = Date.now(),
) {
  const atMs = acquiredAt ? parseAcquiredTimestamp(acquiredAt) : now;
  if (atMs == null || atMs > now) return null;

  const node = nodes.find((item) => item.uuid === uuid);
  if (!node) return null;
  const detail = calculateCostSummary(
    [node],
    ignoredNodes,
    rates,
    {},
    atMs,
  ).details[0];
  if (!detail) return null;
  if (detail.note === "免费") return 0;
  return detail.priceCny > 0 ? detail.remainingCny : null;
}

const CNY_MONEY_FORMATTER = new Intl.NumberFormat("zh-CN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatCnyMoney(value: number) {
  return `¥ ${CNY_MONEY_FORMATTER.format(value || 0)}`;
}
