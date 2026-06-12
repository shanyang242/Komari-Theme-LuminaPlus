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

export function formatBillingCycle(value: string | number | null | undefined) {
  const raw = String(value ?? "").trim();
  const numeric = Number(raw);
  // Only treat as a day-count when the source is a real, non-empty number.
  // `Number("")` is 0 (finite), which previously rendered "0天" for unset cycles.
  if (raw !== "" && Number.isFinite(numeric)) {
    if (numeric === -1) return "永久";
    if (numeric === 30) return "月";
    if (numeric === 90) return "季";
    if (numeric === 180) return "半年";
    if (numeric === 365 || numeric === 360) return "年";
    if (numeric > 0 && numeric % 365 === 0) return `${numeric / 365}年`;
    if (numeric > 0) return `${numeric}天`;
    // numeric <= 0 (e.g. 0) falls through to the label fallback below.
  }

  const normalized = raw.toLowerCase();
  if (/^(monthly|month|mo|月|每月)$/.test(normalized)) return "月";
  if (/^(quarterly|quarter|季|季度|每季)$/.test(normalized)) return "季";
  if (/^(semiannual|semi-annually|halfyear|half-year|半年)$/.test(normalized)) return "半年";
  if (/^(annual|annually|yearly|year|yr|年|每年)$/.test(normalized)) return "年";
  if (/^(lifetime|once|one-time|永久|一次性)$/.test(normalized)) return "永久";
  return "年";
}

export function formatRenewalPrice({
  price,
  currency,
  billing_cycle,
}: {
  price: number;
  currency: string;
  billing_cycle?: string | number | null;
}) {
  if (!Number.isFinite(price) || price <= 0) return null;

  const symbol = currency?.trim() || "¥";
  const cycle = formatBillingCycle(billing_cycle);
  return `${symbol}${formatPriceNumber(price)}/${cycle}`;
}
