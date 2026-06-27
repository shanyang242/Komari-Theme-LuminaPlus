import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  CircleDollarSign,
  RefreshCw,
  X,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Flag } from "@/components/ui/Flag";
import { useAuth } from "@/hooks/useAuth";
import { useAllNodeMeta } from "@/hooks/useNode";
import { useThemeSettings } from "@/hooks/useThemeSettings";
import {
  calculateCostSummary,
  formatCnyMoney,
  getExchangeRates,
} from "@/utils/cost";
import { collectMatchingNodeUuids } from "@/utils/nodeIdentity";
import { getExpireDaysRemaining, LONG_TERM_EXPIRE_DAYS } from "@/utils/format";

type CostSortField = "weight" | "price" | "remain";
type CostSortDirection = "asc" | "desc";

const COST_SORT_OPTIONS: Array<{ field: CostSortField; label: string }> = [
  { field: "weight", label: "权重" },
  { field: "price", label: "价格" },
  { field: "remain", label: "剩余" },
];

function formatCostCycle(days: number) {
  if (days === -1) return "永久";
  if (days === 30) return "月";
  if (days === 90) return "季";
  if (days === 180) return "半年";
  if (days === 365 || days === 360) return "年";
  return days > 0 ? `${days}天` : "年";
}

function formatCostExpiry(expiredAt: string) {
  const days = getExpireDaysRemaining(expiredAt);
  if (days == null) return "到期未知";
  if (days > LONG_TERM_EXPIRE_DAYS) return "长期";
  if (days < 0) return "已过期";
  if (days === 0) return "今日到期";
  return `${days} 天后到期`;
}

function CostMetric({
  label,
  value,
  valueTone,
}: {
  label: string;
  value: string;
  valueTone?: "green";
}) {
  return (
    <div className="cost-summary-metric" data-value-tone={valueTone}>
      <span className="cost-summary-metric-label">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

interface CostSummaryProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  showLauncher?: boolean;
}

export function CostSummary({
  open,
  onOpenChange,
  showLauncher = true,
}: CostSummaryProps = {}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const resolvedOpen = open ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
  const panelRef = useRef<HTMLElement | null>(null);
  const launcherRef = useRef<HTMLButtonElement | null>(null);
  const [sortField, setSortField] = useState<CostSortField>("weight");
  const [sortDirection, setSortDirection] = useState<CostSortDirection>("asc");
  const hiddenTabIndex = resolvedOpen ? undefined : -1;
  const allNodes = useAllNodeMeta();
  const { data: me } = useAuth();
  const themeSettings = useThemeSettings();
  const rateApiUrl = themeSettings.costRateApiUrl;
  // 与首页总览同一可见性口径剔除节点(不进数量/总额/明细):主题级隐藏对所有人剔除;
  // 后台 hidden 仅登录管理员可见,访客一律剔除(否则访客能从资产明细读到隐藏节点的
  // 名称/价格/到期)。auth 未就绪时按访客处理(fail-closed)。
  const hiddenUuids = useMemo(
    () => collectMatchingNodeUuids(allNodes, themeSettings.hiddenNodes),
    [allNodes, themeSettings.hiddenNodes],
  );
  const nodes = useMemo(
    () =>
      allNodes.filter(
        (node) => (me?.logged_in === true || !node.hidden) && !hiddenUuids.has(node.uuid),
      ),
    [allNodes, me?.logged_in, hiddenUuids],
  );
  // 是否挂载、是否显示悬浮球(showLauncher)由父组件 NodeGrid 决定;这里只看数据
  // 是否可用。若改成依赖 showCostSummary,会在卡内详情按钮关闭时错误地把整个组件
  // (连同悬浮球)一起 null 掉。
  const enabled = themeSettings.isReady && nodes.length > 0;
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
      if (a.counted !== b.counted) return a.counted ? -1 : 1;

      const left =
        sortField === "price"
          ? a.priceCny
          : sortField === "remain"
            ? a.remainingCny
            : a.weight;
      const right =
        sortField === "price"
          ? b.priceCny
          : sortField === "remain"
            ? b.remainingCny
            : b.weight;
      const direction = sortDirection === "asc" ? 1 : -1;
      return (left - right) * direction || a.name.localeCompare(b.name, "zh-CN");
    });
  }, [sortDirection, sortField, summary]);
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
  const exchangeRateSummary =
    exchangeRateRows.length > 0
      ? exchangeRateRows
          .slice(0, 3)
          .map((item) => `${item.code} ${formatCnyMoney(item.value)}`)
          .join(" · ")
      : "暂无汇率";

  useEffect(() => {
    if (!resolvedOpen) return;

    const closeIfOutside = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (panelRef.current?.contains(target)) return;
      if (launcherRef.current?.contains(target)) return;
      setOpen(false);
    };

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", closeIfOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeIfOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [resolvedOpen, setOpen]);

  // 移动端底部弹层打开时,收起首页的悬浮控件:它们固定在右上角、z-index 更高,
  // 否则会盖住弹层的关闭按钮、抢走点击。实际隐藏由 CSS 限定在弹层断点内;桌面端
  // 两者不重叠,加这个 class 无害。
  useEffect(() => {
    if (!resolvedOpen) return;
    document.body.classList.add("cost-summary-open");
    return () => document.body.classList.remove("cost-summary-open");
  }, [resolvedOpen]);

  if (!enabled) {
    return null;
  }

  return (
    <>
      <section
        ref={panelRef}
        className={`cost-summary-panel${resolvedOpen ? " show" : ""}`}
        aria-label="服务器花费"
        aria-hidden={!resolvedOpen}
      >
        <div className="cost-summary-header">
          <h3 className="cost-summary-title">资产统计</h3>
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
          <div className="cost-summary-metric-grid">
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
              valueTone="green"
            />
          </div>

          <section className="cost-summary-detail-section" aria-label="服务器剩余价值明细">
            <div className="cost-summary-section-head">
              <div className="cost-summary-section-title">
                <h4>资产明细</h4>
              </div>
              <div className="cost-summary-section-tools">
                <div className="cost-summary-sort-tabs" role="group" aria-label="排序字段">
                  {COST_SORT_OPTIONS.map((option) => (
                    <button
                      key={option.field}
                      type="button"
                      className="cost-summary-sort-tab"
                      data-active={sortField === option.field}
                      onClick={() => setSortField(option.field)}
                      aria-pressed={sortField === option.field}
                      tabIndex={hiddenTabIndex}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="cost-summary-action is-direction"
                  onClick={() => setSortDirection((value) => (value === "asc" ? "desc" : "asc"))}
                  aria-label={sortDirection === "asc" ? "切换为倒序" : "切换为正序"}
                  title={sortDirection === "asc" ? "正序" : "倒序"}
                  tabIndex={hiddenTabIndex}
                >
                  {sortDirection === "asc" ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                </button>
              </div>
            </div>
            <div className="cost-summary-detail-list">
              {summary ? (
                detailRows.map((detail) => {
                  const expiryLabel = formatCostExpiry(detail.expiredAt);
                  const priceLabel =
                    detail.note || `${formatCnyMoney(detail.priceCny)}/${formatCostCycle(detail.billingCycleDays)}`;
                  return (
                    <div
                      key={detail.uuid}
                      className="cost-summary-detail-item"
                      data-counted={detail.counted}
                      title={detail.name}
                    >
                      <div className="cost-summary-detail-name">
                        <span className="cost-summary-detail-line">
                          <Flag region={detail.region} size={12} />
                          <span className="cost-summary-detail-title">{detail.name}</span>
                          <span className="cost-summary-price-chip">{priceLabel}</span>
                          <span className="cost-summary-expire-label">{expiryLabel}</span>
                        </span>
                      </div>
                      <strong>{formatCnyMoney(detail.remainingCny)}</strong>
                    </div>
                  );
                })
              ) : (
                <div className="cost-summary-empty">费用明细加载中</div>
              )}
            </div>
          </section>

          <details className="cost-summary-rate-details">
            <summary tabIndex={hiddenTabIndex}>
              <span>汇率</span>
              <strong>{exchangeRateSummary}</strong>
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
        </div>
      </section>
      {showLauncher && (
        <button
          ref={launcherRef}
          type="button"
          className={`cost-summary-ball${resolvedOpen ? "" : " show"}`}
          onClick={() => setOpen(true)}
          aria-label="打开资产统计"
          title="资产统计"
          tabIndex={resolvedOpen ? -1 : undefined}
        >
          <span className="cost-summary-ball-icon" aria-hidden>
            <CircleDollarSign size={16} />
          </span>
        </button>
      )}
    </>
  );
}
