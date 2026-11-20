import { getExpireDaysRemaining, LONG_TERM_EXPIRE_DAYS } from "@/utils/format";

const INT_PRICE_FORMATTER = new Intl.NumberFormat("zh-CN", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});
const DECIMAL_PRICE_FORMATTER = new Intl.NumberFormat("zh-CN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatPriceNumber(value: number) {
  return (Number.isInteger(value) ? INT_PRICE_FORMATTER : DECIMAL_PRICE_FORMATTER).format(value);
}

function isLongTermExpire(value: string | number | null | undefined) {
  if (value == null) return false;
  const days = getExpireDaysRemaining(value);
  return days != null && days > LONG_TERM_EXPIRE_DAYS;
}

type BillingCycleKind = "month" | "quarter" | "halfYear" | "year" | "lifetime";

function classifyBillingCycleWord(normalized: string): BillingCycleKind | null {
  if (/^(monthly|month|mo|月|每月|月付)$/.test(normalized)) return "month";
  if (/^(quarterly|quarter|季|季度|每季|季付)$/.test(normalized)) return "quarter";
  if (/^(semi-?annual(ly)?|halfyear|half-year|半年|半年付)$/.test(normalized)) return "halfYear";
  if (/^(annual(ly)?|yearly|year|yr|年|每年|年付)$/.test(normalized)) return "year";
  if (/^(lifetime|once|one-time|永久|一次性|买断)$/.test(normalized)) return "lifetime";
  return null;
}

interface NormalizedBillingCycle {
  kind: BillingCycleKind | "days";
  /** 摊销天数（lifetime 为 -1）。 */
  days: number;
  years?: number;
}

/** 归一化账单周期（360 天按年展示但保留原天数；无效值回退年付）。 */
export function normalizeBillingCycle(
  value: string | number | null | undefined,
): NormalizedBillingCycle {
  const raw = String(value ?? "").trim();
  const numeric = Number(raw);
  // 排除空串（Number("") === 0）
  if (raw !== "" && Number.isFinite(numeric)) {
    if (numeric === -1) return { kind: "lifetime", days: -1 };
    if (numeric === 30) return { kind: "month", days: 30 };
    if (numeric === 90) return { kind: "quarter", days: 90 };
    if (numeric === 180) return { kind: "halfYear", days: 180 };
    if (numeric === 365 || numeric === 360) return { kind: "year", days: numeric, years: 1 };
    if (numeric > 0 && numeric % 365 === 0) {
      return { kind: "year", days: numeric, years: numeric / 365 };
    }
    if (numeric > 0) return { kind: "days", days: numeric };
  }

  switch (classifyBillingCycleWord(raw.toLowerCase())) {
    case "month":
      return { kind: "month", days: 30 };
    case "quarter":
      return { kind: "quarter", days: 90 };
    case "halfYear":
      return { kind: "halfYear", days: 180 };
    case "lifetime":
      return { kind: "lifetime", days: -1 };
    case "year":
    default:
      return { kind: "year", days: 365, years: 1 };
  }
}

export function formatBillingCycle(value: string | number | null | undefined) {
  const cycle = normalizeBillingCycle(value);
  switch (cycle.kind) {
    case "lifetime":
      return "永久";
    case "month":
      return "月";
    case "quarter":
      return "季";
    case "halfYear":
      return "半年";
    case "year":
      return (cycle.years ?? 1) === 1 ? "年" : `${cycle.years}年`;
    case "days":
      return `${cycle.days}天`;
  }
}

export function formatRenewalPrice({
  price,
  currency,
  billing_cycle,
  expired_at,
}: {
  price: number;
  currency: string;
  billing_cycle?: string | number | null;
  expired_at?: string | number | null;
}) {
  if (!Number.isFinite(price)) return null;
  if (price === -1) return "免费";
  if (price === 0) return isLongTermExpire(expired_at) ? "免费" : null;
  if (price < 0) return null;

  const symbol = currency?.trim() || "¥";
  const cycle = formatBillingCycle(billing_cycle);
  return `${symbol}${formatPriceNumber(price)}/${cycle}`;
}
