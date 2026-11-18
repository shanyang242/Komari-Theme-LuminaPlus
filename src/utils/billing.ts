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

/**
 * 把自由文本的账单周期关键词(须预先 lowercase/trim)归类成标准周期,识别不出时返回 null。
 * 这里的标签格式化和 utils/cost.ts 里的天数解析共用它,让这套正则只存在一处。
 */
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
  /** 摊销天数;lifetime 为 -1 哨兵。 */
  days: number;
  /** kind === "year" 时的整年数(365/360 天均视为 1 年)。 */
  years?: number;
}

/**
 * 数字/文本账单周期的唯一归一化入口,标签渲染(formatBillingCycle)与成本摊销
 * (cost.ts billingCycleDays)共用,周期档位政策只存在这一处。
 * 注意:360 天(商用年)按「年」展示,但 days 保留原值 360,摊销不悄悄改成 365;
 * 0/负数/不可解析视为未设置,回退年付。
 */
export function normalizeBillingCycle(
  value: string | number | null | undefined,
): NormalizedBillingCycle {
  const raw = String(value ?? "").trim();
  const numeric = Number(raw);
  // 仅当源是真实的非空数字时才当成天数。`Number("")` 是 0(有限值),以前会让未设置的周期渲染成 "0天"。
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
    // numeric <= 0(如 0)落到下面的标签兜底分支。
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
