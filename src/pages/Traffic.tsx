import { Fragment, Suspense, lazy, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp, ChevronDown, ChevronLeft, RefreshCw } from "lucide-react";
import { Flag } from "@/components/ui/Flag";
import { Spinner } from "@/components/ui/Spinner";
import { useMinuteClock } from "@/hooks/useClock";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useTodayTrafficStats } from "@/hooks/useTodayTrafficStats";
import { useVisibleNodes } from "@/hooks/useVisibleNodes";
import { formatByteRateLabel, formatBytes, formatClockTime } from "@/utils/format";
import { MOBILE_VIEWPORT_QUERY } from "@/utils/mediaQuery";
import type { NodeInfo } from "@/types/komari";
import type { TodayTrafficSample, TodayTrafficStat } from "@/utils/trafficStats";

const DAY_FORMATTER = new Intl.DateTimeFormat("zh-CN", {
  month: "long",
  day: "numeric",
  weekday: "short",
});

const TrafficRateChart = lazy(() =>
  import("@/components/traffic/TrafficRateChart").then((module) => ({
    default: module.TrafficRateChart,
  })),
);

interface TrafficDetail {
  node: NodeInfo;
  stat: TodayTrafficStat;
  total: number;
}

function formatPeakTime(timeMs: number | null, value: number) {
  return timeMs != null && value > 0 ? formatClockTime(timeMs) : "—";
}

function PeakValue({ value, timeMs }: { value: number; timeMs: number | null }) {
  return (
    <span className="traffic-peak-value">
      <strong>{formatByteRateLabel(value)}</strong>
      <small>{formatPeakTime(timeMs, value)}</small>
    </span>
  );
}

function PeakSummaryRow({
  direction,
  detail,
}: {
  direction: "up" | "down";
  detail: TrafficDetail | null;
}) {
  const value = direction === "up" ? detail?.stat.peakUp ?? 0 : detail?.stat.peakDown ?? 0;
  const timeMs = direction === "up" ? detail?.stat.peakUpAt ?? null : detail?.stat.peakDownAt ?? null;
  const Icon = direction === "up" ? ArrowUp : ArrowDown;

  return (
    <div className="traffic-summary-peak-row">
      <span className="traffic-summary-peak-label">
        <Icon size={13} strokeWidth={2.4} aria-hidden />
        {direction === "up" ? "上行" : "下行"}
      </span>
      <span className="traffic-summary-peak-main">
        <strong>{detail ? formatByteRateLabel(value) : "—"}</strong>
        <small>
          {detail && value > 0 ? `${detail.node.name} · ${formatPeakTime(timeMs, value)}` : "暂无峰值"}
        </small>
      </span>
    </div>
  );
}

function TrafficDetailToggle({
  expanded,
  controlsId,
  onClick,
}: {
  expanded: boolean;
  controlsId: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="traffic-detail-toggle"
      aria-expanded={expanded}
      aria-controls={controlsId}
      onClick={onClick}
    >
      详情
      <ChevronDown size={13} strokeWidth={2.2} aria-hidden />
    </button>
  );
}

function TrafficSampleChart({
  id,
  samples,
}: {
  id: string;
  samples: TodayTrafficSample[];
}) {
  return (
    <section id={id} className="traffic-detail-panel" aria-label="本日网络上下行明细">
      <header className="traffic-detail-head">
        <strong>本日网络上下行</strong>
        <span>{samples.length} 个采样</span>
      </header>
      {samples.length === 0 ? (
        <div className="traffic-detail-empty">本日暂无速率采样</div>
      ) : (
        <Suspense
          fallback={
            <div className="traffic-chart-loading">
              <Spinner size={18} />
            </div>
          }
        >
          <TrafficRateChart samples={samples} />
        </Suspense>
      )}
    </section>
  );
}

export function Traffic() {
  const [expandedUuid, setExpandedUuid] = useState<string | null>(null);
  const now = useMinuteClock();
  const isMobileLayout = useMediaQuery(MOBILE_VIEWPORT_QUERY);
  const nodes = useVisibleNodes();
  const uuids = useMemo(() => nodes.map((node) => node.uuid), [nodes]);
  const trafficQuery = useTodayTrafficStats(uuids, now);
  const details = useMemo<TrafficDetail[]>(() => {
    const stats = new Map(trafficQuery.data?.rows.map((row) => [row.uuid, row] as const));
    return nodes
      .map((node) => {
        const stat = stats.get(node.uuid) ?? {
          uuid: node.uuid,
          trafficUp: 0,
          trafficDown: 0,
          peakUp: 0,
          peakUpAt: null,
          peakDown: 0,
          peakDownAt: null,
          sampleCount: 0,
          hasSamples: false,
        };
        return { node, stat, total: stat.trafficUp + stat.trafficDown };
      })
      .sort(
        (left, right) =>
          Number(right.stat.hasSamples) - Number(left.stat.hasSamples) ||
          right.total - left.total ||
          left.node.weight - right.node.weight,
      );
  }, [nodes, trafficQuery.data?.rows]);
  const { sampledDetails, totalUp, totalDown, peakUp, peakDown } = useMemo(() => {
    const sampled = details.filter((detail) => detail.stat.hasSamples);
    return {
      sampledDetails: sampled,
      totalUp: sampled.reduce((sum, detail) => sum + detail.stat.trafficUp, 0),
      totalDown: sampled.reduce((sum, detail) => sum + detail.stat.trafficDown, 0),
      peakUp: sampled.reduce<TrafficDetail | null>(
        (best, detail) => (!best || detail.stat.peakUp > best.stat.peakUp ? detail : best),
        null,
      ),
      peakDown: sampled.reduce<TrafficDetail | null>(
        (best, detail) => (!best || detail.stat.peakDown > best.stat.peakDown ? detail : best),
        null,
      ),
    };
  }, [details]);
  const updatedAt = trafficQuery.data?.rangeEndMs ?? now;

  return (
    <div className="traffic-page flex flex-col gap-4 py-2">
      <div className="flex items-center justify-between gap-3">
        <Link to="/" className="instance-page-back">
          <ChevronLeft size={14} />
          返回
        </Link>
        <button
          type="button"
          className={`cost-summary-action${trafficQuery.isFetching ? " is-spinning" : ""}`}
          onClick={() => void trafficQuery.refetch()}
          disabled={trafficQuery.isFetching || nodes.length === 0}
          aria-busy={trafficQuery.isFetching}
          aria-label="刷新今日流量统计"
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
      ) : trafficQuery.isPending ? (
        <div className="flex h-[40vh] items-center justify-center">
          <Spinner size={24} />
        </div>
      ) : trafficQuery.isError ? (
        <section className="traffic-error" role="alert">
          <strong>无法读取今日流量统计</strong>
          <span>请检查网络或历史记录配置后重试。</span>
          <button type="button" onClick={() => void trafficQuery.refetch()}>
            重新加载
          </button>
        </section>
      ) : (
        <>
          <section className="traffic-summary-grid" aria-label="今日流量汇总">
            <article className="traffic-summary-card">
              <div className="traffic-summary-head">
                <span className="assets-eyebrow">今日流量</span>
                <span>{DAY_FORMATTER.format(now)}</span>
              </div>
              <strong className="traffic-summary-total">
                {sampledDetails.length > 0 ? formatBytes(totalUp + totalDown) : "—"}
              </strong>
              <div className="traffic-summary-directions">
                <span><ArrowUp size={13} aria-hidden />{formatBytes(totalUp)}</span>
                <span><ArrowDown size={13} aria-hidden />{formatBytes(totalDown)}</span>
              </div>
            </article>

            <article className="traffic-summary-card">
              <div className="traffic-summary-head">
                <span className="assets-eyebrow">今日采样峰值</span>
                <span>统计至 {formatClockTime(updatedAt)}</span>
              </div>
              <div className="traffic-summary-peak-list">
                <PeakSummaryRow direction="up" detail={peakUp} />
                <PeakSummaryRow direction="down" detail={peakDown} />
              </div>
            </article>
          </section>

          <div className="assets-section-head">
            <span className="assets-eyebrow">节点明细</span>
            <span className="assets-count">{details.length} 台</span>
            <span className="traffic-sample-note">峰值按历史采样计算</span>
          </div>

          {/* 桌面表格与移动卡片按 JS 媒体查询二选一渲染(与 Assets 同方案),
              避免双树同时挂载、展开时 uPlot 图表建两份。 */}
          {!isMobileLayout && (
          <div className="assets-table-wrap traffic-table-wrap">
            <table className="assets-table traffic-table">
              <thead>
                <tr>
                  <th><span>节点</span></th>
                  <th data-numeric><span>今日流量</span></th>
                  <th data-numeric><span>上行峰值</span></th>
                  <th data-numeric><span>下行峰值</span></th>
                  <th data-action><span>操作</span></th>
                </tr>
              </thead>
              <tbody>
                {details.map(({ node, stat, total }) => {
                  const expanded = expandedUuid === node.uuid;
                  const detailId = `traffic-detail-${node.uuid}`;
                  const samples = trafficQuery.data?.samplesByUuid[node.uuid] ?? [];
                  return (
                    <Fragment key={node.uuid}>
                      <tr data-empty={!stat.hasSamples || undefined}>
                        <td>
                          <Link
                            to={`/instance/${encodeURIComponent(node.uuid)}`}
                            className="assets-node-link"
                            title={node.name}
                          >
                            <Flag region={node.region} size={12} />
                            <span>{node.name}</span>
                          </Link>
                        </td>
                        <td data-numeric data-strong>
                          {stat.hasSamples ? (
                            <span className="traffic-volume-value">
                              <strong>{formatBytes(total)}</strong>
                              <small>↑ {formatBytes(stat.trafficUp)} · ↓ {formatBytes(stat.trafficDown)}</small>
                            </span>
                          ) : (
                            <span className="traffic-no-data">无数据</span>
                          )}
                        </td>
                        <td data-numeric>
                          {stat.hasSamples ? <PeakValue value={stat.peakUp} timeMs={stat.peakUpAt} /> : "—"}
                        </td>
                        <td data-numeric>
                          {stat.hasSamples ? <PeakValue value={stat.peakDown} timeMs={stat.peakDownAt} /> : "—"}
                        </td>
                        <td data-action>
                          <TrafficDetailToggle
                            expanded={expanded}
                            controlsId={detailId}
                            onClick={() => setExpandedUuid(expanded ? null : node.uuid)}
                          />
                        </td>
                      </tr>
                      {expanded && (
                        <tr className="traffic-detail-row">
                          <td colSpan={5}>
                            <TrafficSampleChart id={detailId} samples={samples} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          )}

          {isMobileLayout && (
          <div className="assets-card-list traffic-card-list">
            {details.map(({ node, stat, total }) => {
              const expanded = expandedUuid === node.uuid;
              const detailId = `traffic-mobile-detail-${node.uuid}`;
              const samples = trafficQuery.data?.samplesByUuid[node.uuid] ?? [];
              return (
                <article className="traffic-node-card" key={node.uuid} data-empty={!stat.hasSamples || undefined}>
                  <header className="traffic-node-card-head">
                    <Link to={`/instance/${encodeURIComponent(node.uuid)}`} className="assets-node-link">
                      <Flag region={node.region} size={12} />
                      <span>{node.name}</span>
                    </Link>
                    <div className="traffic-node-card-actions">
                      <strong>{stat.hasSamples ? formatBytes(total) : "无数据"}</strong>
                      <TrafficDetailToggle
                        expanded={expanded}
                        controlsId={detailId}
                        onClick={() => setExpandedUuid(expanded ? null : node.uuid)}
                      />
                    </div>
                  </header>
                  {stat.hasSamples && (
                    <>
                      <div className="traffic-node-card-directions">
                        <span>↑ {formatBytes(stat.trafficUp)}</span>
                        <span>↓ {formatBytes(stat.trafficDown)}</span>
                      </div>
                      <dl className="traffic-node-card-peaks">
                        <div>
                          <dt>上行峰值</dt>
                          <dd><PeakValue value={stat.peakUp} timeMs={stat.peakUpAt} /></dd>
                        </div>
                        <div>
                          <dt>下行峰值</dt>
                          <dd><PeakValue value={stat.peakDown} timeMs={stat.peakDownAt} /></dd>
                        </div>
                      </dl>
                    </>
                  )}
                  {expanded && <TrafficSampleChart id={detailId} samples={samples} />}
                </article>
              );
            })}
          </div>
          )}
        </>
      )}
    </div>
  );
}
