import type { NodeInfo } from "@/types/komari";
import { normalizeBillingCycle } from "@/utils/billing";
import { fetchWithTimeout } from "@/utils/abort";
import { resolveExpireTimestamp } from "@/utils/format";
import { buildNodeIdentitySet, nodeMatchesIdentitySet, normalizeNodeIdentityList } from "@/utils/nodeIdentity";

const COST_TARGET_CURRENCY = "CNY";
export const DEFAULT_COST_RATE_API_URL = "https://api.frankfurter.dev/v2/rates?base=USD";
const RATE_CACHE_TTL_MS = 60 * 60 * 1000;
// Legacy key retained so existing users keep their cached exchange rates after the rename.
const RATE_CACHE_KEY_PREFIX = "komaritheme:cost-rates:";
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
  // 溢价加总:不叠加到 remainingCny,也不参与 totalCny/monthlyCny。
  premiumTotalCny: number;
  premiumMonthlyTotalCny: number;
  // 尚未摊销的溢价加总；固定期限节点会随到期临近衰减，到期后归零。
  premiumRemainingTotalCny: number;
  // 真实月均 = monthlyCny + 溢价月摊,仅参考展示,不改变 monthlyCny 口径。
  effectiveMonthlyCny: number;
  // 实际剩余价值 = remainingCny + 尚未摊销的溢价。
  actualRemainingCny: number;
  details: CostSummaryDetail[];
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
  // 摊销月数(见 premiumAmortMonths);未填收购日期时为 null,该节点不参与摊销。
  amortMonths: number | null;
  // 溢价月摊 = 溢价 ÷ 摊销月数。
  premiumMonthlyCny: number;
  // 当前尚未摊销的溢价；用于实际剩余价值，固定期限到期后为 0。
  premiumRemainingCny: number;
  billingCycleDays: number;
  counted: boolean;
  note: string;
}

interface ExchangeRateData {
  rates: Record<string, number>;
  time: number;
  base?: string;
}

type CostNode = NodeInfo & Record<string, unknown>;

// 与「隐藏节点」共用同一套名称/UUID 解析(见 utils/nodeIdentity)。
export const normalizeCostIgnoredNodes = normalizeNodeIdentityList;

// amount = 溢价(录入时固化),paidCny = 收购价原始输入,acquiredAt = 收购日期(YYYY-MM-DD)。
export interface CostPremiumEntry {
  amount: number;
  paidCny?: number;
  acquiredAt?: string;
}

// 地球上最东时区为 UTC+14；按该上限校验 YYYY-MM-DD，避免东时区录入的“今天”被西时区访客或管理员误删/擦除。
const MAX_TIMEZONE_OFFSET_MS = 14 * 60 * 60 * 1000;

function maxWorldDateKey(now = Date.now()) {
  const date = new Date(now + MAX_TIMEZONE_OFFSET_MS);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseUtcDateKey(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
    ? parsed.getTime()
    : null;
}

function parseAcquiredTimestamp(value: string) {
  const utcDate = parseUtcDateKey(value);
  if (utcDate != null) return utcDate;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveEffectiveAcquiredTimestamp(value: string, now: number) {
  const acquiredMs = parseAcquiredTimestamp(value);
  if (acquiredMs == null || acquiredMs > now + MAX_TIMEZONE_OFFSET_MS) return null;
  return Math.min(acquiredMs, now);
}

function normalizeAcquiredAt(value: unknown, now = Date.now()) {
  const raw = typeof value === "string" ? value.trim() : "";
  return parseUtcDateKey(raw) != null && raw <= maxWorldDateKey(now) ? raw : undefined;
}

function parseOptionalFiniteNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? Number.NaN : Number(trimmed);
  }
  return Number.NaN;
}

// 以节点 uuid 为 key。旧版纯数字自动升格为 { amount };非法日期/收购价只丢字段不丢条目;
// 溢价 0 且无收购价的条目整条丢弃(带收购价的 0 溢价是合法记录)。
export function normalizeCostPremiums(value: unknown): Record<string, CostPremiumEntry> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const result: Record<string, CostPremiumEntry> = {};
  for (const [uuid, raw] of Object.entries(value as Record<string, unknown>)) {
    const key = uuid.trim();
    if (!key) continue;

    let amount: number;
    let paidCny: number | undefined;
    let acquiredAt: string | undefined;
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      const entry = raw as Record<string, unknown>;
      amount = parseOptionalFiniteNumber(entry.amount);
      const rawPaid = parseOptionalFiniteNumber(entry.paidCny);
      if (Number.isFinite(rawPaid) && rawPaid >= 0) paidCny = rawPaid;
      acquiredAt = normalizeAcquiredAt(entry.acquiredAt);
    } else {
      amount = parseOptionalFiniteNumber(raw);
    }

    if (!Number.isFinite(amount)) amount = 0;
    if (amount === 0 && paidCny == null) continue;
    result[key] = {
      amount,
      ...(paidCny != null ? { paidCny } : {}),
      ...(acquiredAt ? { acquiredAt } : {}),
    };
  }
  return result;
}

/**
 * 首次录入由调用方传入收购日剩余价值计算溢价；之后仅修改收购价时沿用已固化基准。
 * 若用户主动修改收购日期，调用方应传入新日期的基准且不传 current，以重新固化。
 */
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

// 与 cycleMonths 的 days/30 口径一致;不足 1 月钳到 1,防月摊爆炸。
const AMORT_MONTH_MS = 30 * 24 * 60 * 60 * 1000;
const AMORT_LONG_TERM_MS = 100 * 365 * 24 * 60 * 60 * 1000;

// 溢价摊销月数:优先按 收购日 → 到期日 的整段跨度(两端固定,录入当天就是稳定合理值);
// 无到期/长期(>100 年)/到期早于收购时退回按已持有时间摊。
function premiumAmortMonths(
  acquiredAt: string | undefined,
  expiredAt: string | number | null | undefined,
  now: number,
): number | null {
  if (!acquiredAt) return null;
  const acquiredMs = resolveEffectiveAcquiredTimestamp(acquiredAt, now);
  if (acquiredMs == null) return null;

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
  // 无到期或长期资产没有可靠的终点，保留全部溢价，不伪造摊销进度。
  if (expiresMs == null || expiresMs - now >= AMORT_LONG_TERM_MS) return premium;
  if (expiresMs <= now) return 0;

  const acquiredMs = acquiredAt ? resolveEffectiveAcquiredTimestamp(acquiredAt, now) : null;
  if (
    acquiredMs == null ||
    acquiredMs >= expiresMs ||
    expiresMs - acquiredMs >= AMORT_LONG_TERM_MS
  ) {
    // 没有有效收购日期时无法推导已摊比例；到期前保留、到期时归零。
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
  // 空值或非 http(s) 时回退到默认端点,免得坏掉的持久化设置进到 fetch()(那样每个周期都会抛错)。
  return raw && isCostRateApiUrlValid(raw) ? raw : DEFAULT_COST_RATE_API_URL;
}

function currencyCode(value: unknown) {
  const raw = String(value ?? "").trim();
  // 未设置的货币默认按运营者的目标货币(CNY)算,而不是 USD——默认成 USD 会让没填货币、按 CNY 定价的
  // 节点在总额和剩余价值里被悄悄乘上 USD 汇率(约 7 倍)。
  if (!raw) return COST_TARGET_CURRENCY;

  const key = raw.toUpperCase().replace(/\s+/g, "").replace("＄", "$");
  return CURRENCY_ALIASES[key] || (/^[A-Z]{3}$/.test(key) ? key : "");
}

// 周期档位政策统一在 billing.normalizeBillingCycle;这里只取摊销天数(lifetime 为 -1)。
function billingCycleDays(value: unknown): number {
  return normalizeBillingCycle(value as string | number | null | undefined).days;
}

function cycleMonths(days: number) {
  if (days === 365 || days === 360) return 12;
  if (days === 30) return 1;
  // 整年倍数(2 年 =730、3 年 =1095…)用 /365 精确年化,而不是用 /30 兜底(那样多年周期会偏低约 1.4%)。
  if (days > 0 && days % 365 === 0) return (days / 365) * 12;
  if (days > 0) return days / 30;
  return 0;
}

function remainingCycleValue(
  price: number,
  cycleDays: number,
  expiredAt: string | number | null | undefined,
  atMs: number = Date.now(),
) {
  const expiresMs = resolveExpireTimestamp(expiredAt);
  // 没有真实到期(未设置 / 永久 / Go 零时哨兵):当成下面 >100 年的情况——永久 / 一次性购买仍算作
  // 一个周期的预付价值,而不是从剩余总额里悄悄消失。
  if (expiresMs == null) return price;

  const diffMs = expiresMs - atMs;
  if (diffMs <= 0) return 0;

  // 到期超过 100 年的节点属于长期 / 一次性购买(后端自动续费也是这么处理的)——报一个周期的价值,
  // 而不是天文数字的倍数。
  const diffYears = diffMs / (1000 * 60 * 60 * 24 * 365);
  if (diffYears > 100) return price;

  if (cycleDays > 0) {
    // `price` 是单个账单周期的费用(后端每续一个周期就把到期时间往后推一期),所以仍剩的预付价值就是
    // 到期前剩余周期数 × price。这里故意不设上限:月付套餐预付了 6 个月的节点,确实剩 6 倍周期价。
    return price * (diffMs / (cycleDays * 24 * 60 * 60 * 1000));
  }

  return price;
}

// 统一签名格式:符号一律放在 ¥ 前面(+¥ x / -¥ x),0 也带 +,避免「+¥」和「¥ -」两种写法混用。
export function formatSignedCny(value: number) {
  const sign = value < 0 ? "-" : "+";
  return `${sign}${formatCnyMoney(Math.abs(value))}`;
}

function readRateCache(
  cacheKey: string,
  fallbackBase?: string | null,
  allowExpired = false,
): ExchangeRateData | null {
  try {
    const cached = JSON.parse(localStorage.getItem(cacheKey) || "null") as unknown;
    if (!cached || typeof cached !== "object" || Array.isArray(cached)) return null;
    const record = cached as Record<string, unknown>;
    const time = typeof record.time === "number" ? record.time : Number.NaN;
    const age = Date.now() - time;
    if (!Number.isFinite(time) || age < 0 || (!allowExpired && age >= RATE_CACHE_TTL_MS)) {
      return null;
    }
    return { ...parseRatePayload(record, fallbackBase), time };
  } catch {
    return null;
  }
}

function writeRateCache(cacheKey: string, data: ExchangeRateData) {
  try {
    localStorage.setItem(cacheKey, JSON.stringify(data));
  } catch {
    // React Query 在当前页面会话里仍把最新值留在内存中。
  }
}

function normalizeBaseCurrency(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(trimmed) ? trimmed : null;
}

function inferBaseFromRateUrl(rateApiUrl: string): string | null {
  try {
    const parsed = new URL(rateApiUrl);
    return normalizeBaseCurrency(
      parsed.searchParams.get("base") ?? parsed.searchParams.get("base_code"),
    );
  } catch {
    return null;
  }
}

export function parseRatePayload(
  payload: unknown,
  fallbackBase?: string | null,
): Pick<ExchangeRateData, "rates" | "base"> {
  const rates: Record<string, number> = {};
  let hasValidSource = false;
  let explicitBase: string | null = null;

  if (Array.isArray(payload)) {
    hasValidSource = true;
    for (const item of payload) {
      const record = item && typeof item === "object" ? (item as Record<string, unknown>) : null;
      if (!record) continue;
      explicitBase ??= normalizeBaseCurrency(record.base ?? record.base_code);
      const quote = record.quote;
      const rate = Number(record.rate);
      if (typeof quote === "string" && Number.isFinite(rate) && rate > 0) {
        rates[quote.toUpperCase()] = rate;
      }
    }
  } else if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    explicitBase = normalizeBaseCurrency(record.base ?? record.base_code);
    const rawRates = record.rates ?? record.conversion_rates;
    if (rawRates && typeof rawRates === "object" && !Array.isArray(rawRates)) {
      hasValidSource = true;
      for (const [key, value] of Object.entries(rawRates)) {
        const rate = Number(value);
        if (Number.isFinite(rate) && rate > 0) {
          rates[key.toUpperCase()] = rate;
        }
      }
    }
  }

  if (!hasValidSource) {
    throw new Error("target rate missing");
  }

  const resolvedBase = explicitBase ?? normalizeBaseCurrency(fallbackBase) ?? null;
  if (resolvedBase) {
    if (rates[resolvedBase] == null) {
      rates[resolvedBase] = 1;
    }
  } else if (
    Object.keys(rates).length > 0 &&
    !Object.values(rates).includes(1) &&
    rates.USD == null
  ) {
    // 兼容既未声明 base 也未含基准 1（且自身不含 USD 汇率）的旧版/极简 USD 基准返回（如 `{ rates: { CNY: 7 } }`）。
    rates.USD = 1;
  }

  if (!rates[COST_TARGET_CURRENCY]) {
    throw new Error("target rate missing");
  }

  return {
    rates,
    ...(resolvedBase ? { base: resolvedBase } : {}),
  };
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
  const fallbackBase = inferBaseFromRateUrl(rateApiUrl);
  const cached = options.ignoreCache ? null : readRateCache(cacheKey, fallbackBase);
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

    const parsed = parseRatePayload(
      await response.json(),
      fallbackBase,
    );
    const data: ExchangeRateData = {
      ...parsed,
      time: Date.now(),
    };
    writeRateCache(cacheKey, data);
    return data;
  } catch (error) {
    if (options.signal?.aborted) throw error;
    const old = readRateCache(cacheKey, fallbackBase, true);
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
    // 溢价以人民币直接记录、不依赖价格与汇率,免费/汇率缺失节点照样计入 premiumTotalCny,
    // 不能因价格校验不过就静默丢掉;它不参与 remaining/monthly/totalCny。
    const entry = premiums[node.uuid];
    const premium = entry?.amount ?? 0;
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
      amortMonths,
      premiumMonthlyCny: premiumMonthly,
      premiumRemainingCny: premiumRemaining,
      billingCycleDays: cycleDays,
    };

    if (nodeMatchesIdentitySet(node, ignored)) {
      // 忽略名单是整节点退出费用统计,溢价一并不计、不展示(premiumCny 归零)。
      details.push({
        ...baseDetail,
        premiumCny: 0,
        amortMonths: null,
        premiumMonthlyCny: 0,
        premiumRemainingCny: 0,
        counted: false,
        note: "已忽略",
      });
      continue;
    }

    const price = Number(node.price) || 0;
    if (price <= 0) {
      premiumTotalCny += premium;
      premiumMonthlyTotalCny += premiumMonthly;
      premiumRemainingTotalCny += premiumRemaining;
      details.push({
        ...baseDetail,
        counted: false,
        note: "免费",
      });
      continue;
    }

    const converted = convertToCny(price, node.currency, rates);
    if (converted == null || !Number.isFinite(converted)) {
      premiumTotalCny += premium;
      premiumMonthlyTotalCny += premiumMonthly;
      premiumRemainingTotalCny += premiumRemaining;
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

    // `totalCny` 是年化支出(月度 ×12),这样不同账单周期的节点能在同一口径上相加;永久/一次性节点
    // (monthly === 0)对这个周期性总额不贡献。
    totalCny += monthly * 12;
    monthlyCny += monthly;
    remainingCny += remaining;
    premiumTotalCny += premium;
    premiumMonthlyTotalCny += premiumMonthly;
    premiumRemainingTotalCny += premiumRemaining;

    details.push({
      ...baseDetail,
      priceCny: converted,
      monthlyCny: monthly,
      remainingCny: remaining,
      counted: true,
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

/**
 * 使用当前价格、账单周期、到期日和汇率，把剩余价值的计算时点回拨到收购日。
 * 返回值只用于首次计算或主动修改收购日期时固化溢价，不会随之后的汇率/续费变化自动更新。
 */
export function calculateCostPremiumBasisAt(
  nodes: NodeInfo[],
  ignoredNodes: string[],
  rates: Record<string, number>,
  uuid: string,
  acquiredAt?: string,
  now = Date.now(),
) {
  const atMs = acquiredAt ? resolveEffectiveAcquiredTimestamp(acquiredAt, now) : now;
  if (atMs == null) return null;

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
  return detail.counted ? detail.remainingCny : null;
}

const CNY_MONEY_FORMATTER = new Intl.NumberFormat("zh-CN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatCnyMoney(value: number) {
  return `¥ ${CNY_MONEY_FORMATTER.format(value || 0)}`;
}
