import { useMemo, useState } from "react";
import { CircleDollarSign, RefreshCw, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useAllNodeMeta } from "@/hooks/useNode";
import { useThemeSettings } from "@/hooks/useThemeSettings";
import {
  calculateCostSummary,
  formatCnyMoney,
  getExchangeRates,
} from "@/utils/cost";

function CostMetric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="cost-summary-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function CostSummary() {
  const [open, setOpen] = useState(false);
  const [sortBy, setSortBy] = useState("weight_asc");
  const hiddenTabIndex = open ? undefined : -1;
  const nodes = useAllNodeMeta();
  const themeSettings = useThemeSettings();
  const rateApiUrl = themeSettings.costRateApiUrl;
  const enabled = themeSettings.showCostSummary && nodes.length > 0;
  const rateQuery = useQuery({
    queryKey: ["cost-rates", rateApiUrl],
    queryFn: () => getExchangeRates(rateApiUrl),
    staleTime: 60 * 60 * 1000,
    enabled,
    retry: 1,
  });

  const ignoredNodes = themeSettings.costIgnoredNodes;
  const rate = rateQuery.data;
  const summary = useMemo(
    () => (rate ? calculateCostSummary(nodes, ignoredNodes, rate.rates) : null),
    [nodes, ignoredNodes, rate],
  );
  const detailRows = useMemo(() => {
    const rows = summary?.details.slice() ?? [];
    return rows.sort((a, b) => {
      if (sortBy === "weight_desc") return b.weight - a.weight;
      if (sortBy === "price_asc") return a.priceCny - b.priceCny;
      if (sortBy === "price_desc") return b.priceCny - a.priceCny;
      if (sortBy === "remain_asc") return a.remainingCny - b.remainingCny;
      if (sortBy === "remain_desc") return b.remainingCny - a.remainingCny;
      return a.weight - b.weight;
    });
  }, [sortBy, summary]);
  const exchangeRateRows = useMemo(() => {
    if (!rate?.rates.CNY) return [];

    return ["USD", "HKD", "EUR", "GBP", "JPY"]
      .map((code) => {
        const sourceRate = rate.rates[code];
        if (!sourceRate) return null;
        return {
          code,
          value: rate.rates.CNY / sourceRate,
        };
      })
      .filter((item): item is { code: string; value: number } => Boolean(item));
  }, [rate]);
  const statusParts = [
    rate
      ? `${rate.stale ? "缓存汇率" : "实时汇率"} ${rate.date || "latest"}`
      : rateQuery.isLoading
        ? "汇率加载中"
        : "汇率获取失败",
    summary ? `计费 ${summary.paidCount}` : "",
    summary && summary.freeCount > 0 ? `免费 ${summary.freeCount}` : "",
    summary && summary.ignoredCount > 0 ? `忽略 ${summary.ignoredCount}` : "",
    summary && summary.skippedCount > 0 ? `跳过 ${summary.skippedCount}` : "",
  ].filter(Boolean);

  if (!enabled) {
    return null;
  }

  return (
    <>
      <section
        className={`cost-summary-panel${open ? " show" : ""}`}
        aria-label="服务器花费"
        aria-hidden={!open}
      >
        <div className="cost-summary-header">
          <h3 className="cost-summary-title">
            <span className="cost-summary-icon" aria-hidden>
              <CircleDollarSign size={18} />
            </span>
            资产统计
          </h3>
          <button
            type="button"
            className="cost-summary-close"
            onClick={() => setOpen(false)}
            aria-label="关闭服务器花费"
            title="关闭"
            tabIndex={hiddenTabIndex}
          >
            <X size={18} />
          </button>
        </div>
        <div className="cost-summary-content">
          <CostMetric
            label="服务器数量"
            value={summary ? `${summary.nodeCount}` : "计算中"}
          />
          <CostMetric
            label="年化总支出"
            value={summary ? formatCnyMoney(summary.totalCny) : "计算中"}
          />
          <CostMetric
            label="月均支出"
            value={summary ? formatCnyMoney(summary.monthlyCny) : "--"}
          />
          <CostMetric
            label="剩余价值"
            value={summary ? formatCnyMoney(summary.remainingCny) : "--"}
          />
          <div className="cost-summary-detail-list" aria-label="服务器剩余价值明细">
            {summary ? (
              detailRows.map((detail) => (
                <div
                  key={detail.uuid}
                  className="cost-summary-detail-item"
                  data-counted={detail.counted}
                  title={detail.name}
                >
                  <div className="cost-summary-detail-name">
                    <span>{detail.name}</span>
                    {detail.note && <em>{detail.note}</em>}
                  </div>
                  <strong>{formatCnyMoney(detail.remainingCny)}</strong>
                </div>
              ))
            ) : (
              <div className="cost-summary-empty">费用明细加载中</div>
            )}
          </div>
          <div className="cost-summary-status">{statusParts.join(" · ")}</div>
          {exchangeRateRows.length > 0 && (
            <div className="cost-summary-rate-list" aria-label="汇率">
              {exchangeRateRows.map((item) => (
                <div className="cost-summary-rate-item" key={item.code}>
                  <span>1 {item.code}</span>
                  <strong>{formatCnyMoney(item.value)}</strong>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="cost-summary-actions">
          <select
            className="cost-summary-select"
            aria-label="显示币种"
            value="CNY"
            disabled
            tabIndex={hiddenTabIndex}
          >
            <option value="CNY">CNY (￥)</option>
          </select>
          <select
            className="cost-summary-select"
            aria-label="排序"
            value={sortBy}
            onChange={(event) => setSortBy(event.target.value)}
            tabIndex={hiddenTabIndex}
          >
            <option value="weight_asc">权重 正序</option>
            <option value="weight_desc">权重 倒序</option>
            <option value="price_asc">价格 正序</option>
            <option value="price_desc">价格 倒序</option>
            <option value="remain_asc">剩余 正序</option>
            <option value="remain_desc">剩余 倒序</option>
          </select>
          <button
            type="button"
            className={`cost-summary-action${rateQuery.isFetching ? " is-spinning" : ""}`}
            onClick={() => {
              void rateQuery.refetch();
            }}
            aria-label="刷新服务器花费"
            title="刷新"
            tabIndex={hiddenTabIndex}
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </section>
      <button
        type="button"
        className={`cost-summary-ball${open ? "" : " show"}`}
        onClick={() => setOpen(true)}
        aria-label="打开资产统计"
        title="资产统计"
        tabIndex={open ? -1 : undefined}
      >
        <span className="cost-summary-ball-icon" aria-hidden>
          <CircleDollarSign size={16} />
        </span>
      </button>
    </>
  );
}
