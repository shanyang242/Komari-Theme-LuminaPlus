import { useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Link, Navigate } from "react-router-dom";
import { CalendarClock, ChevronLeft, RefreshCw } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Flag } from "@/components/ui/Flag";
import { Spinner } from "@/components/ui/Spinner";
import { useThemeSettings } from "@/hooks/useThemeSettings";
import { useAuth } from "@/hooks/useAuth";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useHourlyClock } from "@/hooks/useClock";
import { useVisibleNodes } from "@/hooks/useVisibleNodes";
import {
  calculateCostSummary,
  formatCnyMoney,
  formatCostPayback,
  formatSignedCny,
  getExchangeRates,
} from "@/utils/cost";
import { formatBillingCycle } from "@/utils/billing";
import { getExpireDaysRemaining, LONG_TERM_EXPIRE_DAYS } from "@/utils/format";
import {
  getRenewalReminders,
} from "@/utils/renewalReminder";
import { canViewCosts } from "@/utils/themeSettings";

const TABLE_COLUMNS = [
  { label: "节点" },
  { label: "价格", numeric: true, sortKey: "price" },
  { label: "剩余价值", numeric: true, sortKey: "remaining" },
  { label: "溢价", numeric: true },
  { label: "回本状态", numeric: true },
  { label: "到期", numeric: true },
] as const;

type AssetSort =
  | { key: "weight"; direction: "asc" }
  | { key: "price" | "remaining"; direction: "asc" | "desc" };

const ASSETS_MOBILE_QUERY = "(max-width: 720px)";

function formatCostExpiry(expiredAt: string) {
  const days = getExpireDaysRemaining(expiredAt);
  if (days == null) return "到期未知";
  if (days > LONG_TERM_EXPIRE_DAYS) return "长期";
  if (days < 0) return "已过期";
  if (days === 0) return "今日到期";
  return `${days} 天后到期`;
}

function premiumTone(value: number) {
  if (value > 0) return "var(--status-error)";
  if (value < 0) return "var(--status-success)";
  return "var(--text-tertiary)";
}

function assetsRenewalTone(daysRemaining: number): "critical" | "warning" {
  return daysRemaining <= 3 ? "critical" : "warning";
}

function assetsRenewalLabel(daysRemaining: number) {
  return daysRemaining < 0 ? "已过期" : "即将到期";
}

// "¥ 1,234.56" → 货币符号 / 整数位 / 小数位三段,按报表数字惯例分级排印。
function HeroMoney({ value }: { value: number | null }) {
  if (value == null) {
    return <span className="assets-hero-value is-pending">计算中</span>;
  }
  const [int, frac = "00"] = formatCnyMoney(value).replace("¥", "").trim().split(".");
  return (
    <span className="assets-hero-value">
      <span className="assets-hero-currency">¥</span>
      {int}
      <span className="assets-hero-frac">.{frac}</span>
    </span>
  );
}

export function Assets() {
  const isMobileLayout = useMediaQuery(ASSETS_MOBILE_QUERY);
  const now = useHourlyClock();
  const themeSettings = useThemeSettings();
  const { data: me, isPending: authPending, isError: authError } = useAuth();
  const costsVisible =
    !authPending &&
    canViewCosts(themeSettings, !authError && me?.logged_in === true);
  const forceRateRefresh = useRef(false);
  const [sort, setSort] = useState<AssetSort>({ key: "weight", direction: "asc" });
  const nodes = useVisibleNodes();
  // 资产详情页是风险核对入口：这里始终按真实到期数据展示，不读取首页的关闭/稍后偏好。
  const renewalReminders = useMemo(() => getRenewalReminders(nodes, now), [nodes, now]);
  const renewalByUuid = useMemo(
    () => new Map(renewalReminders.map((item) => [item.uuid, item])),
    [renewalReminders],
  );
  const rateQuery = useQuery({
    queryKey: ["cost-rates", themeSettings.costRateApiUrl],
    queryFn: ({ signal }) => {
      const ignoreCache = forceRateRefresh.current;
      forceRateRefresh.current = false;
      return getExchangeRates(themeSettings.costRateApiUrl, { signal, ignoreCache });
    },
    staleTime: 60 * 60 * 1000,
    enabled: costsVisible && nodes.length > 0,
    retry: 1,
  });
  const summary = useMemo(
    () =>
      costsVisible && rateQuery.data
        ? calculateCostSummary(
            nodes,
            themeSettings.costIgnoredNodes,
            rateQuery.data.rates,
            themeSettings.costPremiums,
            now,
          )
        : null,
    [costsVisible, nodes, now, themeSettings.costIgnoredNodes, themeSettings.costPremiums, rateQuery.data],
  );
  const detailRows = useMemo(() => {
    const rows = [...(summary?.details ?? [])];
    if (sort.key === "weight") {
      return rows.sort((left, right) => left.weight - right.weight);
    }
    const field = sort.key === "price" ? "priceCny" : "remainingCny";
    const direction = sort.direction === "asc" ? 1 : -1;
    return rows.sort((left, right) => (left[field] - right[field]) * direction);
  }, [sort, summary]);
  const cycleSort = (key: "price" | "remaining") => {
    setSort((current) => {
      if (current.key !== key) return { key, direction: "asc" };
      if (current.direction === "asc") return { key, direction: "desc" };
      return { key: "weight", direction: "asc" };
    });
  };
  const exchangeRateRows = useMemo(() => {
    if (!rateQuery.data?.rates.CNY) return [];
    const rates = rateQuery.data.rates;
    return ["USD", "HKD", "EUR", "GBP", "JPY"]
      .map((code) => (rates[code] ? { code, value: rates.CNY / rates[code] } : null))
      .filter((item): item is { code: string; value: number } => Boolean(item));
  }, [rateQuery.data]);

  if (!themeSettings.isReady || authPending) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Spinner size={24} />
      </div>
    );
  }

  if (!costsVisible) {
    return <Navigate to="/" replace />;
  }

  const hasPremium = summary?.details.some((detail) => detail.premiumCny !== 0) ?? false;
  const ledgerRows: Array<{
    label: string;
    value: string;
    tone?: string;
    title?: string;
  }> = [
    { label: "年化总支出", value: summary ? formatCnyMoney(summary.totalCny) : "--" },
    { label: "月均支出", value: summary ? formatCnyMoney(summary.monthlyCny) : "--" },
    ...(summary != null && hasPremium
      ? [
          {
            label: "溢价盈亏",
            value: formatSignedCny(summary.premiumTotalCny),
            tone: premiumTone(summary.premiumTotalCny),
            title:
              "所有节点「收购溢价」的加总（正数=溢价多花钱，负数=折价少花钱），只反映溢价本身的赚亏，不叠加到剩余价值/年化/月均里",
          },
        ]
      : []),
  ];

  return (
    <div className="assets-page flex flex-col gap-4 py-2">
      <div className="flex items-center justify-between gap-3">
        <Link to="/" className="instance-page-back">
          <ChevronLeft size={14} />
          返回
        </Link>
        <button
          type="button"
          className={`cost-summary-action${rateQuery.isFetching ? " is-spinning" : ""}`}
          onClick={() => {
            forceRateRefresh.current = true;
            void rateQuery.refetch();
          }}
          disabled={rateQuery.isFetching}
          aria-busy={rateQuery.isFetching}
          aria-label="刷新汇率与统计"
          title="刷新"
        >
          <RefreshCw size={16} />
        </button>
      </div>

      {nodes.length === 0 ? (
        <div className="flex h-[40vh] flex-col items-center justify-center gap-2 text-[var(--text-tertiary)]">
          <span className="text-[15px]">暂无节点数据</span>
          <span className="text-[12px]">等待后端推送或前往管理后台添加</span>
        </div>
      ) : (
        <>
          <section className="assets-hero" aria-label="资产汇总">
            <span className="assets-hero-mark" aria-hidden>
              ¥
            </span>
            <div className="assets-hero-main">
              <span className="assets-eyebrow" title="按各节点账单价格折算的剩余价值，不含收购溢价">
                剩余价值
              </span>
              <HeroMoney value={summary ? summary.remainingCny : null} />
            </div>
            <dl className="assets-ledger">
              {ledgerRows.map((row) => (
                <div className="assets-ledger-row" key={row.label} title={row.title}>
                  <dt>{row.label}</dt>
                  <dd style={row.tone ? { color: row.tone } : undefined}>{row.value}</dd>
                </div>
              ))}
            </dl>
          </section>

          <div className="assets-section-head">
            <span className="assets-eyebrow">明细</span>
            <span className="assets-count">{detailRows.length} 台</span>
            {renewalReminders.length > 0 && (
              <span className="assets-renewal-inline">
                <CalendarClock size={12} strokeWidth={2.1} />
                {renewalReminders.length} 台临期
              </span>
            )}
          </div>

          {summary ? (
            <>
              {!isMobileLayout ? (
                <div className="assets-table-wrap">
                <table className="assets-table">
                  <thead>
                    <tr>
                      {TABLE_COLUMNS.map((column) => (
                        <th
                          key={column.label}
                          data-numeric={("numeric" in column && column.numeric) || undefined}
                          aria-sort={
                            "sortKey" in column && sort.key === column.sortKey
                              ? sort.direction === "asc" ? "ascending" : "descending"
                              : undefined
                          }
                        >
                          {"sortKey" in column ? (
                            <button
                              type="button"
                              className="assets-sort-button"
                              data-active={sort.key === column.sortKey || undefined}
                              onClick={() => cycleSort(column.sortKey)}
                              title="点击切换升序、降序与 Komari 权重顺序"
                            >
                              <span>{column.label}</span>
                              <span aria-hidden className="assets-sort-indicator">
                                {sort.key === column.sortKey
                                  ? sort.direction === "asc" ? "↑" : "↓"
                                  : "↕"}
                              </span>
                            </button>
                          ) : column.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {detailRows.map((detail) => {
                      const reminder = renewalByUuid.get(detail.uuid);
                      const renewalTone = reminder
                        ? assetsRenewalTone(reminder.daysRemaining)
                        : undefined;
                      const renewalLabel = reminder
                        ? assetsRenewalLabel(reminder.daysRemaining)
                        : undefined;
                      return (
                        <tr
                          key={detail.uuid}
                          data-counted={detail.counted}
                          data-billing-ignored={detail.billingIgnored || undefined}
                          data-renewal-tone={renewalTone}
                        >
                        <td>
                          <Link
                            to={`/instance/${encodeURIComponent(detail.uuid)}`}
                            className="assets-node-link"
                            title={detail.name}
                          >
                            <Flag region={detail.region} size={12} />
                            <span>{detail.name}</span>
                            {detail.billingIgnored && (
                              <small className="assets-note-chip is-billing-ignored">
                                忽略下期
                              </small>
                            )}
                          </Link>
                        </td>
                        <td data-numeric>
                          {detail.counted ? (
                            `${formatCnyMoney(detail.priceCny)}/${formatBillingCycle(detail.billingCycleDays)}`
                          ) : (
                            <span className="assets-note-chip">{detail.note}</span>
                          )}
                        </td>
                        <td data-numeric data-strong>
                          {detail.counted ? formatCnyMoney(detail.remainingCny) : "—"}
                        </td>
                        <td data-numeric>
                          {detail.premiumCny !== 0 ? (
                            <span style={{ color: premiumTone(detail.premiumCny) }}>
                              {formatSignedCny(detail.premiumCny)}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td data-numeric>
                          {detail.premiumCny !== 0 &&
                          (detail.counted || detail.note === "免费")
                            ? formatCostPayback(detail.payback)
                            : "—"}
                        </td>
                        <td data-numeric>
                          {reminder ? (
                            <span
                              className="assets-expiry-reminder"
                              data-tone={renewalTone}
                              title={renewalLabel}
                            >
                              <span>{formatCostExpiry(detail.expiredAt)}</span>
                              <small>{renewalLabel}</small>
                            </span>
                          ) : (
                            formatCostExpiry(detail.expiredAt)
                          )}
                        </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                </div>
              ) : (
                <div className="assets-card-list">
                {detailRows.map((detail) => {
                  const reminder = renewalByUuid.get(detail.uuid);
                  const renewalTone = reminder
                    ? assetsRenewalTone(reminder.daysRemaining)
                    : undefined;
                  const renewalLabel = reminder
                    ? assetsRenewalLabel(reminder.daysRemaining)
                    : undefined;
                  const priceLabel = detail.counted
                    ? `${formatCnyMoney(detail.priceCny)}/${formatBillingCycle(detail.billingCycleDays)}`
                    : detail.note || "—";
                  return (
                    <div
                      key={detail.uuid}
                      className="cost-summary-detail-item"
                      data-counted={detail.counted}
                      data-billing-ignored={detail.billingIgnored || undefined}
                      data-renewal-tone={renewalTone}
                      title={detail.name}
                    >
                      <div className="cost-summary-detail-head">
                        <Link
                          to={`/instance/${encodeURIComponent(detail.uuid)}`}
                          className="cost-summary-detail-name"
                        >
                          <Flag region={detail.region} size={12} />
                          <span className="cost-summary-detail-title">{detail.name}</span>
                          {detail.billingIgnored && (
                            <small className="assets-note-chip is-billing-ignored">
                              忽略下期
                            </small>
                          )}
                        </Link>
                        <strong title="剩余价值">
                          {detail.counted ? formatCnyMoney(detail.remainingCny) : "—"}
                        </strong>
                      </div>
                      <div className="cost-summary-detail-meta">
                        <span className="cost-summary-price-chip">{priceLabel}</span>
                        {detail.premiumCny !== 0 && (
                          <span
                            className="cost-summary-premium-chip"
                            style={
                              { "--cost-premium-color": premiumTone(detail.premiumCny) } as CSSProperties
                            }
                            title="收购溢价（正数=多花钱溢价买入，负数=折价买入）"
                          >
                            {formatSignedCny(detail.premiumCny)} 溢价
                          </span>
                        )}
                        {detail.premiumCny !== 0 &&
                          (detail.regularPriceCny != null || detail.premiumCny < 0) &&
                          (detail.counted || detail.note === "免费") && (
                          <span
                            className="cost-summary-premium-chip"
                            title="按收购日起正价与当前续费价的累计价差计算"
                          >
                            {formatCostPayback(detail.payback)}
                          </span>
                        )}
                        <span
                          className="cost-summary-expire-label"
                          data-tone={renewalTone}
                        >
                          {formatCostExpiry(detail.expiredAt)}
                          {renewalLabel && <small>{renewalLabel}</small>}
                        </span>
                      </div>
                    </div>
                  );
                })}
                </div>
              )}
            </>
          ) : (
            <div className="cost-summary-empty">
              {rateQuery.isError ? "汇率获取失败，点击右上角刷新重试" : "费用明细加载中"}
            </div>
          )}

          <details className="cost-summary-rate-details">
            <summary>
              <span>汇率</span>
              <strong>
                {exchangeRateRows.length > 0
                  ? exchangeRateRows
                      .slice(0, 3)
                      .map((item) => `${item.code} ${formatCnyMoney(item.value)}`)
                      .join(" · ")
                  : "暂无汇率"}
              </strong>
            </summary>
            {exchangeRateRows.length > 0 ? (
              <div className="cost-summary-rate-list" aria-label="汇率">
                {exchangeRateRows.map((item) => (
                  <div className="cost-summary-rate-item" key={item.code}>
                    <span>1 {item.code}</span>
                    <strong>{formatCnyMoney(item.value)}</strong>
                  </div>
                ))}
              </div>
            ) : (
              <div className="cost-summary-empty is-compact">暂无可用汇率</div>
            )}
          </details>
        </>
      )}
    </div>
  );
}
