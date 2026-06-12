import type { NodeInfo } from "@/types/komari";

const COST_TARGET_CURRENCY = "CNY";
export const DEFAULT_COST_RATE_API_URL = "https://api.frankfurter.dev/v2/rates?base=USD";
const RATE_CACHE_TTL_MS = 60 * 60 * 1000;
const RATE_CACHE_KEY_PREFIX = "komaritheme:cost-rates:";

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
  nodeCount: number;
  paidCount: number;
  freeCount: number;
  ignoredCount: number;
  skippedCount: number;
  totalCny: number;
  monthlyCny: number;
  remainingCny: number;
  details: CostSummaryDetail[];
}

interface CostSummaryDetail {
  uuid: string;
  name: string;
  weight: number;
  priceCny: number;
  monthlyCny: number;
  remainingCny: number;
  billingCycleDays: number;
  counted: boolean;
  note: string;
}

interface ExchangeRateData {
  rates: Record<string, number>;
  date: string;
  time: number;
  stale: boolean;
}

type CostNode = NodeInfo & Record<string, unknown>;

function normalizeComparable(value: unknown) {
  return String(value == null ? "" : value).trim().toLowerCase();
}

export function normalizeCostIgnoredNodes(value: unknown): string[] {
  const rawValues = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[\n,，;；]+/)
      : [];

  return Array.from(
    new Set(
      rawValues
        .map((item) => (typeof item === "string" || typeof item === "number" ? String(item).trim() : ""))
        .filter(Boolean),
    ),
  );
}

export function normalizeCostRateApiUrl(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  return raw || DEFAULT_COST_RATE_API_URL;
}

function currencyCode(value: unknown) {
  const raw = String(value || "$").trim();
  if (!raw) return "USD";

  const key = raw.toUpperCase().replace(/\s+/g, "").replace("＄", "$");
  return CURRENCY_ALIASES[key] || (/^[A-Z]{3}$/.test(key) ? key : "");
}

function billingCycleDays(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;

  const raw = String(value ?? "").trim();
  if (!raw) return 365;

  const numeric = Number(raw);
  if (Number.isFinite(numeric)) return numeric;

  const normalized = raw.toLowerCase();
  if (/^(monthly|month|mo|月|每月)$/.test(normalized)) return 30;
  if (/^(quarterly|quarter|季|季度|每季)$/.test(normalized)) return 90;
  if (/^(semiannual|semi-annually|halfyear|half-year|半年)$/.test(normalized)) return 180;
  if (/^(annual|annually|yearly|year|yr|年|每年)$/.test(normalized)) return 365;
  if (/^(lifetime|once|one-time|永久|一次性)$/.test(normalized)) return -1;
  return 365;
}

function cycleMonths(days: number) {
  if (days === 365 || days === 360) return 12;
  if (days === 30) return 1;
  if (days > 0) return days / 30;
  return 0;
}

function remainingCycleValue(price: number, cycleDays: number, expiredAt: unknown) {
  if (!expiredAt) return 0;

  const expires = new Date(String(expiredAt));
  if (Number.isNaN(expires.getTime())) return 0;

  const diffMs = expires.getTime() - Date.now();
  if (diffMs <= 0) return 0;

  // A node whose expiry is >100 years out is a long-term / one-time purchase
  // (the backend's auto-renewal treats it the same way) — report one cycle's
  // worth rather than an astronomical multiple.
  const diffYears = diffMs / (1000 * 60 * 60 * 24 * 365);
  if (diffYears > 100) return price;

  if (cycleDays > 0) {
    // `price` is the cost of a single billing cycle (one cycle advances the
    // expiry by one period on the backend), so the prepaid value still owed is
    // the number of cycles remaining until expiry × price. This is intentionally
    // unbounded above: a node paid 6 months ahead on a monthly plan really does
    // have 6× the cycle price remaining.
    return price * (diffMs / (cycleDays * 24 * 60 * 60 * 1000));
  }

  return price;
}

function buildIgnoredSet(ignoredNodes: string[]): Set<string> {
  return new Set(ignoredNodes.map(normalizeComparable).filter(Boolean));
}

function isIgnoredNode(node: CostNode, ignored: Set<string>) {
  if (ignored.size === 0) return false;

  const values = [
    node.id,
    node.uuid,
    node.name,
    node.display_name,
    node.remark,
    node.alias,
    node.public_remark,
  ]
    .map(normalizeComparable)
    .filter(Boolean);

  return values.some((value) => ignored.has(value));
}

function readRateCache(cacheKey: string, allowExpired = false): ExchangeRateData | null {
  try {
    const cached = JSON.parse(localStorage.getItem(cacheKey) || "null") as ExchangeRateData | null;
    if (
      cached &&
      cached.rates &&
      (!allowExpired || Date.now() - cached.time >= 0) &&
      (allowExpired || Date.now() - cached.time < RATE_CACHE_TTL_MS)
    ) {
      return cached;
    }
  } catch {
    return null;
  }
  return null;
}

function writeRateCache(cacheKey: string, data: ExchangeRateData) {
  try {
    localStorage.setItem(cacheKey, JSON.stringify(data));
  } catch {
    // React Query still keeps the latest value in memory for the current page session.
  }
}

function parseRatePayload(payload: unknown): Pick<ExchangeRateData, "rates" | "date"> {
  const rates: Record<string, number> = { USD: 1 };
  let date = "";

  if (Array.isArray(payload)) {
    for (const item of payload) {
      const record = item && typeof item === "object" ? (item as Record<string, unknown>) : null;
      const quote = record?.quote;
      const rate = Number(record?.rate);
      if (typeof quote === "string" && Number.isFinite(rate) && rate > 0) {
        rates[quote.toUpperCase()] = rate;
        date ||= typeof record?.date === "string" ? record.date : "";
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
    date = typeof record.date === "string" ? record.date : "";
  }

  if (!rates[COST_TARGET_CURRENCY]) {
    throw new Error("target rate missing");
  }

  return { rates, date };
}

export async function getExchangeRates(rateApiUrl: string): Promise<ExchangeRateData> {
  const cacheKey = `${RATE_CACHE_KEY_PREFIX}${rateApiUrl}`;
  const cached = readRateCache(cacheKey);
  if (cached) return cached;

  try {
    const response = await fetch(rateApiUrl, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`rate http ${response.status}`);
    }

    const parsed = parseRatePayload(await response.json());
    const data: ExchangeRateData = {
      ...parsed,
      time: Date.now(),
      stale: false,
    };
    writeRateCache(cacheKey, data);
    return data;
  } catch (error) {
    const old = readRateCache(cacheKey, true);
    if (old) {
      return { ...old, stale: true };
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
): CostSummary {
  let totalCny = 0;
  let monthlyCny = 0;
  let remainingCny = 0;
  let paidCount = 0;
  let freeCount = 0;
  let ignoredCount = 0;
  let skippedCount = 0;
  const details: CostSummaryDetail[] = [];
  const ignored = buildIgnoredSet(ignoredNodes);

  for (const node of nodes as CostNode[]) {
    const name = node.name || node.display_name || node.remark || node.uuid;
    const cycleDays = billingCycleDays(node.billing_cycle);
    const baseDetail = {
      uuid: node.uuid,
      name: String(name || "未命名服务器"),
      weight: Number(node.weight) || 0,
      priceCny: 0,
      monthlyCny: 0,
      remainingCny: 0,
      billingCycleDays: cycleDays,
    };

    if (isIgnoredNode(node, ignored)) {
      ignoredCount += 1;
      details.push({
        ...baseDetail,
        counted: false,
        note: "已忽略",
      });
      continue;
    }

    const price = Number(node.price) || 0;
    if (price <= 0) {
      freeCount += 1;
      details.push({
        ...baseDetail,
        counted: false,
        note: "免费",
      });
      continue;
    }

    const converted = convertToCny(price, node.currency, rates);
    if (converted == null || !Number.isFinite(converted)) {
      skippedCount += 1;
      details.push({
        ...baseDetail,
        counted: false,
        note: "汇率缺失",
      });
      continue;
    }

    const months = cycleMonths(cycleDays);
    const monthly = months > 0 ? converted / months : 0;
    const remaining = remainingCycleValue(converted, cycleDays, node.expired_at);

    totalCny += converted;
    monthlyCny += monthly;
    remainingCny += remaining;
    paidCount += 1;

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
    nodeCount: nodes.length,
    paidCount,
    freeCount,
    ignoredCount,
    skippedCount,
    totalCny,
    monthlyCny,
    remainingCny,
    details: details.sort(
      (a, b) => a.weight - b.weight || a.name.localeCompare(b.name, "zh-CN"),
    ),
  };
}

const CNY_MONEY_FORMATTER = new Intl.NumberFormat("zh-CN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatCnyMoney(value: number) {
  return `¥ ${CNY_MONEY_FORMATTER.format(value || 0)}`;
}
