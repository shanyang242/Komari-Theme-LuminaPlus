import { memo, useCallback, useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  Cpu,
  Gauge,
  MemoryStick,
  HardDrive,
  Globe,
  ArrowDown,
  ArrowUp,
  Clock3,
  Unplug,
  Calendar,
  RefreshCw,
  Power,
  CircleDollarSign,
} from "lucide-react";
import { useNodeCardModel } from "@/hooks/useNodeCardModel";
import { usePreferences } from "@/hooks/usePreferences";
import {
  formatBytes,
  formatOfflineDuration,
} from "@/utils/format";
import {
  latencyHeatColor,
  lossHeatColor,
} from "@/utils/metricTone";
import { Flag } from "@/components/ui/Flag";
import { OsLogo } from "@/components/ui/OsLogo";
import { MetricBar } from "./MetricBar";
import { MiniBars } from "./MiniBars";
import { QualityBars } from "./QualityBars";
import { CanvasStrip, resolveCssColor } from "./CanvasStrip";
import { nodeDetailLinkLabels } from "./nodeCardShared";
import {
  formatLatencyBucketSummary,
  formatLossBucketSummary,
  formatPingBucketWindow,
} from "./pingBucketText";
import { clsx } from "clsx";
import type { NodeInfo, NodeMetrics, PingOverviewBucket, PingOverviewItem, TrafficTrendSample } from "@/types/komari";
import type { TrafficRateDisplay } from "@/utils/format";

type NodeCardNode = NodeInfo & NodeMetrics;
type DisplayStat = { value: string; unit: string };
type DisplayTag = { label: string; color: string };

export const NodeCard = memo(function NodeCard({
  uuid,
}: {
  uuid: string;
}) {
  const { resolvedAppearance } = usePreferences();
  const model = useNodeCardModel(uuid);
  const [hoveredLatencyIndex, setHoveredLatencyIndex] = useState<number | null>(null);
  const [hoveredLossIndex, setHoveredLossIndex] = useState<number | null>(null);

  if (!model.node) {
    return (
      <div
        className="server-card animate-pulse"
        style={{ minHeight: 438 }}
        aria-busy
      />
    );
  }

  const {
    node,
    trafficTrend,
    ping,
    pingBuckets,
    footerTags,
    subtitle,
    expire,
    expireColor,
    uptime,
    renewalPrice,
    latencyColor,
    lossColor,
    loadFraction,
    upRate,
    downRate,
    hasHomepagePingBinding,
    isOnline,
    isOffline,
    offlineSince,
    osName,
  } = model;
  const hoveredLatencyBucket =
    hoveredLatencyIndex != null ? (pingBuckets[hoveredLatencyIndex] ?? null) : null;
  const hoveredLossBucket =
    hoveredLossIndex != null ? (pingBuckets[hoveredLossIndex] ?? null) : null;
  const latencyHoverTime = formatPingBucketWindow(hoveredLatencyBucket);
  const lossHoverTime = formatPingBucketWindow(hoveredLossBucket);
  const latencyHoverColor = hoveredLatencyBucket?.value != null
    ? latencyHeatColor(hoveredLatencyBucket.value)
    : "var(--text-tertiary)";
  const lossHoverColor = hoveredLossBucket ? lossHeatColor(hoveredLossBucket.loss) : null;

  return (
    <article
      className={clsx("server-card", isOffline && "is-offline")}
      data-appearance={resolvedAppearance}
    >
      {isOffline && <OfflineMask offlineSince={offlineSince} />}

      <div className="server-card-content">
        <NodeCardHeader node={node} subtitle={subtitle} osName={osName} />

        <div className="server-card-stack">
          <NodeMetricSection
            node={node}
            loadFraction={loadFraction}
            redrawKey={resolvedAppearance}
          />

          <NodeTrafficSection
            node={node}
            upRate={upRate}
            downRate={downRate}
            trafficTrend={trafficTrend}
            isOnline={isOnline}
            redrawKey={resolvedAppearance}
          />

          <NodeHealthSection
            ping={ping}
            pingBuckets={pingBuckets}
            redrawKey={resolvedAppearance}
            hasHomepagePingBinding={hasHomepagePingBinding}
            latencyColor={latencyColor}
            lossColor={lossColor}
            latencyHoverTime={latencyHoverTime}
            lossHoverTime={lossHoverTime}
            hoveredLatencyBucket={hoveredLatencyBucket}
            hoveredLossBucket={hoveredLossBucket}
            latencyHoverColor={latencyHoverColor}
            lossHoverColor={lossHoverColor}
            onLatencyHover={setHoveredLatencyIndex}
            onLossHover={setHoveredLossIndex}
          />
        </div>

        <NodeCardFooter
          expire={expire}
          expireColor={expireColor}
          uptime={uptime}
          footerTags={footerTags}
          renewalPrice={renewalPrice}
        />
      </div>
    </article>
  );
});

function OfflineMask({ offlineSince }: { offlineSince: number }) {
  // This component only mounts for offline cards, so the interval runs solely
  // for them. Re-rendering every 30s keeps the "离线 N 分钟" badge advancing even
  // though the node's metrics (and the card model memo) have stopped updating.
  const [, forceTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => forceTick((value) => value + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const offlineFor = formatOfflineDuration(offlineSince);
  return (
    <div className="offline-mask">
      <span className="offline-badge" title={offlineFor.full}>
        <Power size={14} strokeWidth={2.2} />
        <span className="offline-badge-copy">
          <span>离线</span>
          <span className="offline-badge-time">
            {offlineFor.value}
            {offlineFor.unit ? ` ${offlineFor.unit}` : ""}
          </span>
        </span>
      </span>
    </div>
  );
}

function NodeCardHeader({
  node,
  subtitle,
  osName,
}: {
  node: NodeCardNode;
  subtitle: string;
  osName: string;
}) {
  const detailLabels = nodeDetailLinkLabels(node.name, osName);
  return (
    <header className="server-card-header">
      <div className="server-card-title-block">
        <div className="server-card-title-row">
          <Flag region={node.region} size={15} />
          <Link
            to={`/instance/${node.uuid}`}
            className="server-card-title-link"
            title={node.name}
          >
            {node.name}
          </Link>
        </div>
        {subtitle && (
          <p className="server-card-subtitle" title={subtitle}>
            {subtitle}
          </p>
        )}
      </div>
      <Link
        to={`/instance/${node.uuid}`}
        className="server-card-detail-link"
        title={detailLabels.title}
        aria-label={detailLabels.ariaLabel}
      >
        <OsLogo value={node.os} size={15} />
      </Link>
    </header>
  );
}

function NodeMetricSection({
  node,
  loadFraction,
  redrawKey,
}: {
  node: NodeCardNode;
  loadFraction: number;
  redrawKey: string;
}) {
  return (
    <div className="card-metric-section server-metric-grid">
      <MetricBar
        icon={<Cpu size={13} strokeWidth={2} />}
        label="CPU"
        valueText={node.cpuPct.toFixed(2)}
        unit="%"
        detailText={`${node.cpu_cores || 0} 核`}
        fraction={node.cpuPct / 100}
        redrawKey={redrawKey}
        paint={{ kind: "solid", color: "var(--progress-cpu)" }}
      />
      <MetricBar
        icon={<MemoryStick size={13} strokeWidth={2} />}
        label="内存"
        valueText={node.ramPct.toFixed(2)}
        unit="%"
        detailText={`${formatBytes(node.ramUsed)} / ${formatBytes(node.ramTotal)}`}
        fraction={node.ramPct / 100}
        redrawKey={redrawKey}
        paint={{ kind: "solid", color: "var(--progress-memory)" }}
      />
      <MetricBar
        icon={<HardDrive size={13} strokeWidth={2} />}
        label="磁盘"
        valueText={node.diskPct.toFixed(1)}
        unit="%"
        detailText={`${formatBytes(node.diskUsed)} / ${formatBytes(node.diskTotal)}`}
        fraction={node.diskPct / 100}
        redrawKey={redrawKey}
        paint={{ kind: "solid", color: "var(--progress-disk)" }}
      />
      <MetricBar
        icon={<Gauge size={13} strokeWidth={2} />}
        label="负载"
        valueText={node.load1.toFixed(2)}
        fraction={loadFraction}
        redrawKey={redrawKey}
        paint={{
          kind: "gradient",
          from: "var(--progress-cpu)",
          to: "var(--progress-memory)",
        }}
      />
    </div>
  );
}

function NodeTrafficSection({
  node,
  upRate,
  downRate,
  trafficTrend,
  isOnline,
  redrawKey,
}: {
  node: NodeCardNode;
  upRate: TrafficRateDisplay;
  downRate: TrafficRateDisplay;
  trafficTrend: { up: TrafficTrendSample[]; down: TrafficTrendSample[] };
  isOnline: boolean;
  redrawKey: string;
}) {
  return (
    <div className="card-metric-section server-traffic-section">
      <TrafficStat
        direction="上行"
        totalLabel="出站"
        rate={upRate}
        total={formatBytes(node.trafficUp)}
        samples={trafficTrend.up}
        live={isOnline}
        redrawKey={redrawKey}
        color="var(--progress-cpu)"
        icon={<ArrowUp size={15} strokeWidth={2.4} />}
      />
      <TrafficStat
        direction="下行"
        totalLabel="入站"
        rate={downRate}
        total={formatBytes(node.trafficDown)}
        samples={trafficTrend.down}
        live={isOnline}
        redrawKey={redrawKey}
        color="var(--status-success)"
        icon={<ArrowDown size={15} strokeWidth={2.4} />}
      />
    </div>
  );
}

// Memoized: across the ~1s metrics ticks that re-render the parent card, every
// prop here is reference-stable — ping data refreshes ~every 60s, the hover
// state only moves on pointer interaction, and the onHover props are stable
// setState identities — so the latency/loss bars subtree skips per-tick work.
const NodeHealthSection = memo(function NodeHealthSection({
  ping,
  pingBuckets,
  redrawKey,
  hasHomepagePingBinding,
  latencyColor,
  lossColor,
  latencyHoverTime,
  lossHoverTime,
  hoveredLatencyBucket,
  hoveredLossBucket,
  latencyHoverColor,
  lossHoverColor,
  onLatencyHover,
  onLossHover,
}: {
  ping: PingOverviewItem;
  pingBuckets: PingOverviewBucket[];
  redrawKey: string;
  hasHomepagePingBinding: boolean;
  latencyColor: string;
  lossColor: string;
  latencyHoverTime: string | null;
  lossHoverTime: string | null;
  hoveredLatencyBucket: PingOverviewBucket | null;
  hoveredLossBucket: PingOverviewBucket | null;
  latencyHoverColor: string;
  lossHoverColor: string | null;
  onLatencyHover: (index: number | null) => void;
  onLossHover: (index: number | null) => void;
}) {
  const emptyTitle = hasHomepagePingBinding ? "暂无有效样本" : "未配置首页 Ping";
  const emptyText = hasHomepagePingBinding ? "无样本" : "未配置";

  return (
    <div className="card-metric-section card-metric-divided server-health-grid">
      <div className="server-health-block">
        <div className="server-health-head">
          <div className="server-health-label">
            <Clock3 size={13} strokeWidth={2} />
            <span>延迟</span>
          </div>
          <span className="server-health-value tabular" style={{ color: latencyColor }}>
            {ping.lastValue != null ? (
              <>
                {Math.round(ping.lastValue)}
                <span className="server-health-unit">ms</span>
              </>
            ) : (
              <span className="server-health-empty" title={emptyTitle}>
                {emptyText}
              </span>
            )}
          </span>
        </div>
        <div className="server-health-chart-wrap">
          {hasHomepagePingBinding ? (
            <MiniBars
              max={ping.max}
              buckets={pingBuckets}
              redrawKey={redrawKey}
              onHoverIndex={onLatencyHover}
            />
          ) : (
            <div className="server-health-placeholder">未配置首页 Ping</div>
          )}
          {latencyHoverTime && hoveredLatencyBucket && (
            <div className="server-health-tooltip">
              <div className="instance-chart-tooltip-time">{latencyHoverTime}</div>
              <div className="instance-chart-tooltip-row">
                <span className="instance-chart-tooltip-dot" style={{ background: latencyHoverColor }} />
                <span>延迟</span>
                <strong>{formatLatencyBucketSummary(hoveredLatencyBucket)}</strong>
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="server-health-block">
        <div className="server-health-head">
          <div className="server-health-label">
            <Unplug size={13} strokeWidth={2} />
            <span>丢包率</span>
          </div>
          <span className="server-health-value tabular" style={{ color: lossColor }}>
            {ping.loss != null ? (
              <>
                {ping.loss.toFixed(1)}
                <span className="server-health-unit">%</span>
              </>
            ) : (
              <span className="server-health-empty" title={emptyTitle}>
                {emptyText}
              </span>
            )}
          </span>
        </div>
        <div className="server-health-chart-wrap">
          {hasHomepagePingBinding ? (
            <QualityBars
              buckets={pingBuckets}
              redrawKey={redrawKey}
              onHoverIndex={onLossHover}
            />
          ) : (
            <div className="server-health-placeholder">未配置首页 Ping</div>
          )}
          {lossHoverTime && hoveredLossBucket && (
            <div className="server-health-tooltip">
              <div className="instance-chart-tooltip-time">{lossHoverTime}</div>
              <div className="instance-chart-tooltip-row">
                <span className="instance-chart-tooltip-dot" style={{ background: lossHoverColor ?? lossColor }} />
                <span>丢包率</span>
                <strong>{formatLossBucketSummary(hoveredLossBucket)}</strong>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

function NodeCardFooter({
  expire,
  expireColor,
  uptime,
  footerTags,
  renewalPrice,
}: {
  expire: DisplayStat;
  expireColor: string;
  uptime: DisplayStat;
  footerTags: DisplayTag[];
  renewalPrice: string | null;
}) {
  return (
    <div className="server-card-footer">
      <div className="server-card-meta-grid">
        <FooterStat
          icon={<Calendar size={13} strokeWidth={2} />}
          label="到期"
          value={expire.value}
          unit={expire.unit}
          color={expireColor}
        />
        <FooterStat
          icon={<RefreshCw size={13} strokeWidth={2} />}
          label="在线"
          value={uptime.value}
          unit={uptime.unit}
          color="var(--progress-cpu)"
        />
      </div>
      {(footerTags.length > 0 || renewalPrice) && (
        <div className="dstatus-tags-row">
          {footerTags.slice(0, 6).map((tag, index) => (
            <span
              key={`${tag.label}-${index}`}
              data-tag={tag.color}
              className="dstatus-tag-chip"
              style={{
                background: "var(--tag-bg)",
                color: "var(--tag-fg)",
              }}
              title={tag.label}
            >
              {tag.label}
            </span>
          ))}
          {footerTags.length > 6 && (
            <span className="dstatus-tag-more">+{footerTags.length - 6}</span>
          )}
          {renewalPrice && (
            <span className="dstatus-price-chip" title={`续费价格 ${renewalPrice}`}>
              <CircleDollarSign size={12} strokeWidth={2.2} />
              {renewalPrice}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function TrafficStat({
  direction,
  totalLabel,
  rate,
  total,
  samples,
  live,
  redrawKey,
  color,
  icon,
}: {
  direction: "下行" | "上行";
  totalLabel: "入站" | "出站";
  rate: TrafficRateDisplay;
  total: string;
  samples: TrafficTrendSample[];
  live: boolean;
  redrawKey: string;
  color: string;
  icon: ReactNode;
}) {
  return (
    <div className="traffic-stat">
      <div className="traffic-stat-head">
        <div className="traffic-stat-label" style={{ color }}>
          {icon}
          <span>{direction}</span>
        </div>
        <span className="traffic-stat-value tabular" style={{ color }}>
          {rate.value}
          <span className="traffic-stat-unit">{rate.unit}</span>
        </span>
      </div>
      <div className="traffic-stat-trend" aria-hidden>
        <TrafficDotStrip samples={samples} color={color} redrawKey={redrawKey} />
        <span className="traffic-stat-live" data-live={live ? "true" : "false"}>
          <span
            className="traffic-stat-live-dot"
            style={{
              background: color,
            }}
          />
          <span>{live ? (rate.bitsPerSec > 0 ? "实时" : "空闲") : "离线"}</span>
        </span>
      </div>
      <div className="traffic-stat-foot">
        <div className="traffic-stat-total-label">
          <GlobeArrow direction={totalLabel} color={color} />
          <span>{totalLabel}</span>
        </div>
        <span className="tabular">{total}</span>
      </div>
    </div>
  );
}

function TrafficDotStrip({
  samples,
  color,
  redrawKey,
}: {
  samples: TrafficTrendSample[];
  color: string;
  redrawKey: string;
}) {
  // Stable unless the traffic samples (a cached store snapshot) or color change,
  // so the canvas only redraws when the trend actually moves.
  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, width: number, height: number) => {
      if (samples.length === 0) return;
      const slotWidth = width / samples.length;
      const baseColor = resolveCssColor(color);
      const inactiveColor = resolveCssColor("var(--progress-bg)");

      samples.forEach((sample, index) => {
        const hasTraffic = sample.value > 0;
        const scale = hasTraffic ? 0.72 + sample.level * 0.82 : 0.46;
        const radius = 2 * scale;
        const tone = hasTraffic
          ? `color-mix(in srgb, ${baseColor} ${Math.round(68 + sample.level * 20)}%, white ${Math.round(32 - sample.level * 20)}%)`
          : inactiveColor;
        const x = index * slotWidth + slotWidth / 2;
        const y = height / 2;

        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fillStyle = tone;
        ctx.globalAlpha = hasTraffic ? Math.min(1, sample.opacity + 0.05) : 0.46;
        ctx.fill();
      });

      ctx.globalAlpha = 1;
    },
    [samples, color],
  );

  return (
    <CanvasStrip
      className="traffic-dot-strip"
      height={10}
      ariaHidden
      redrawKey={redrawKey}
      draw={draw}
    />
  );
}

function GlobeArrow({
  direction,
  color,
}: {
  direction: "入站" | "出站";
  color: string;
}) {
  const isInbound = direction === "入站";
  return (
    <span
      className="relative inline-flex items-center justify-center"
      style={{
        width: 18,
        height: 18,
        color,
      }}
      aria-hidden
    >
      <Globe size={15} strokeWidth={1.9} />
      {isInbound ? (
        <ArrowDown
          size={9}
          strokeWidth={2.4}
          className="absolute -right-[2px] bottom-[-1px]"
        />
      ) : (
        <ArrowUp
          size={9}
          strokeWidth={2.4}
          className="absolute -right-[2px] bottom-[-1px]"
        />
      )}
    </span>
  );
}

function FooterStat({
  icon,
  label,
  value,
  unit,
  color,
}: {
  label: string;
  value: string;
  unit?: string;
  color: string;
  icon: ReactNode;
}) {
  return (
    <div className="server-card-meta">
      <div className="server-card-meta-label">
        {icon}
        <span>{label}</span>
      </div>
      <span className="server-card-meta-value tabular" style={{ color }}>
        {value}
        {unit && <span className="server-card-meta-unit">{unit}</span>}
      </span>
    </div>
  );
}
