import { memo, useCallback, useState, type ReactNode } from "react";
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
  CircleDollarSign,
} from "lucide-react";
import { useNodeCardModel } from "@/hooks/useNodeCardModel";
import { usePreferences } from "@/hooks/usePreferences";
import { useThemeSettings } from "@/hooks/useThemeSettings";
import { useMetricColorsVersion } from "@/hooks/useMetricColors";
import { formatBytes } from "@/utils/format";
import {
  speedRateColor,
  trafficQuotaSegmentColor,
} from "@/utils/metricTone";
import { Flag } from "@/components/ui/Flag";
import { OsLogo } from "@/components/ui/OsLogo";
import { MetricBar } from "./MetricBar";
import { HealthBars } from "./HealthBars";
import { CanvasStrip, safeCanvasColor } from "./CanvasStrip";
import { TrafficQuotaLabel } from "./TrafficQuotaLabel";
import type { TrafficResetDisplay } from "@/utils/trafficReset";
import {
  joinTagTitle,
  nodeDetailLinkLabels,
  pingEmptyLabels,
  TRAFFIC_SLIVER_RATIO,
} from "./nodeCardShared";
import { IpStackBadges } from "./IpStackBadges";
import { HealthBucketTooltip } from "./HealthBucketTooltip";
import { MerchantLinkAction } from "./MerchantLinkAction";
import { formatHealthBucketTooltip } from "./pingBucketText";
import { clsx } from "clsx";
import type { NodeInfo, NodeMetrics, PingOverviewBucket, PingOverviewItem, TrafficTrendSample } from "@/types/komari";
import type { ByteRateDisplay } from "@/utils/format";

type NodeCardNode = NodeInfo & NodeMetrics;
type DisplayStat = { value: string; unit: string };
type DisplayTag = { label: string; color: string };

export const NodeCard = memo(function NodeCard({
  uuid,
  showCosts = true,
}: {
  uuid: string;
  showCosts?: boolean;
}) {
  const { resolvedAppearance } = usePreferences();
  const colorsVersion = useMetricColorsVersion();
  const redrawKey = `${resolvedAppearance}:${colorsVersion}`;
  const model = useNodeCardModel(uuid);
  const themeSettings = useThemeSettings();

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
    traffic,
    trafficReset,
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
    hasRealHomepagePingBinding,
    shouldRenderPingBars,
    pingLoading,
    pingError,
    isOnline,
    isOffline,
    osName,
  } = model;

  return (
    <article
      className={clsx("server-card", isOffline && "is-offline")}
    >
      <div className="server-card-content">
        <NodeCardHeader
          node={node}
          subtitle={subtitle}
          osName={osName}
          merchantLink={themeSettings.nodeMerchantLinks[node.uuid]}
        />

        <div className="server-card-stack">
          <NodeMetricSection
            node={node}
            loadFraction={loadFraction}
            redrawKey={redrawKey}
          />

          <NodeTrafficSection
            node={node}
            upRate={upRate}
            downRate={downRate}
            trafficTrend={trafficTrend}
            isOnline={isOnline}
            redrawKey={redrawKey}
          />

          <NodeTrafficQuota
            litCount={trafficQuotaLitCount(traffic.fraction)}
            remainingLabel={traffic.remainingLabel}
            detail={traffic.detail}
            typeLabel={traffic.typeLabel}
            reset={trafficReset}
          />

          <NodeHealthSection
            ping={ping}
            pingBuckets={pingBuckets}
            redrawKey={redrawKey}
            hasRealHomepagePingBinding={hasRealHomepagePingBinding}
            shouldRenderPingBars={shouldRenderPingBars}
            pingLoading={pingLoading}
            pingError={pingError}
            latencyColor={latencyColor}
            lossColor={lossColor}
          />
        </div>

        <NodeCardFooter
          expire={expire}
          expireColor={expireColor}
          uptime={uptime}
          footerTags={footerTags}
          renewalPrice={showCosts ? renewalPrice : null}
        />
      </div>
    </article>
  );
});

function NodeCardHeader({
  node,
  subtitle,
  osName,
  merchantLink,
}: {
  node: NodeCardNode;
  subtitle: string;
  osName: string;
  merchantLink: import("@/utils/merchantLinks").NodeMerchantLink | undefined;
}) {
  const detailLabels = nodeDetailLinkLabels(node.name, osName);
  return (
    <header className="server-card-header">
      <div className="server-card-title-block">
        <div className="server-card-title-row">
          <Flag region={node.region} size={15} />
          <Link
            to={`/instance/${encodeURIComponent(node.uuid)}`}
            className="server-card-title-link"
            title={node.name}
          >
            {node.name}
          </Link>
        </div>
        {(subtitle || node.ipv4 || node.ipv6) && (
          <div className="server-card-subtitle-row">
            {subtitle && (
              <span className="server-card-subtitle" title={subtitle}>
                {subtitle}
              </span>
            )}
            <IpStackBadges ipv4={node.ipv4} ipv6={node.ipv6} />
          </div>
        )}
      </div>
      <div className="server-card-actions">
        <MerchantLinkAction
          link={merchantLink}
          className="server-card-detail-link"
        />
        <Link
          to={`/instance/${encodeURIComponent(node.uuid)}`}
          className="server-card-detail-link"
          title={detailLabels.title}
          aria-label={detailLabels.ariaLabel}
        >
          <OsLogo value={node.os} size={15} />
        </Link>
      </div>
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
        paint="var(--progress-cpu)"
      />
      <MetricBar
        icon={<MemoryStick size={13} strokeWidth={2} />}
        label="内存"
        valueText={node.ramPct.toFixed(2)}
        unit="%"
        detailText={`${formatBytes(node.ramUsed)} / ${formatBytes(node.ramTotal)}`}
        fraction={node.ramPct / 100}
        redrawKey={redrawKey}
        paint="var(--progress-memory)"
      />
      <MetricBar
        icon={<HardDrive size={13} strokeWidth={2} />}
        label="磁盘"
        valueText={node.diskPct.toFixed(1)}
        unit="%"
        detailText={`${formatBytes(node.diskUsed)} / ${formatBytes(node.diskTotal)}`}
        fraction={node.diskPct / 100}
        redrawKey={redrawKey}
        paint="var(--progress-disk)"
      />
      <MetricBar
        icon={<Gauge size={13} strokeWidth={2} />}
        label="负载"
        valueText={node.load1.toFixed(2)}
        fraction={loadFraction}
        redrawKey={redrawKey}
        paint="var(--progress-load)"
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
  upRate: ByteRateDisplay;
  downRate: ByteRateDisplay;
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
        active={node.netUp > 0}
        redrawKey={redrawKey}
        color="var(--traffic-up)"
        icon={<ArrowUp size={15} strokeWidth={2.4} />}
      />
      <TrafficStat
        direction="下行"
        totalLabel="入站"
        rate={downRate}
        total={formatBytes(node.trafficDown)}
        samples={trafficTrend.down}
        live={isOnline}
        active={node.netDown > 0}
        redrawKey={redrawKey}
        color="var(--traffic-down)"
        icon={<ArrowDown size={15} strokeWidth={2.4} />}
      />
    </div>
  );
}

const TRAFFIC_QUOTA_SEGMENTS = 18;

const TRAFFIC_QUOTA_SEGMENT_COLORS = Array.from(
  { length: TRAFFIC_QUOTA_SEGMENTS },
  (_, i) => trafficQuotaSegmentColor((i + 0.5) / TRAFFIC_QUOTA_SEGMENTS),
);

// 离散点亮段数（便于 memo 跳过重渲染）；-1 表示极小非零用量的段内细边
function trafficQuotaLitCount(fraction: number) {
  let count = 0;
  for (let i = 0; i < TRAFFIC_QUOTA_SEGMENTS; i++) {
    if ((i + 0.5) / TRAFFIC_QUOTA_SEGMENTS <= fraction) count += 1;
    else break;
  }
  if (count === 0 && fraction > 0) return -1;
  return count;
}

const NodeTrafficQuota = memo(function NodeTrafficQuota({
  litCount,
  remainingLabel,
  detail,
  typeLabel,
  reset,
}: {
  litCount: number;
  remainingLabel: string;
  detail: string;
  typeLabel: string;
  reset: TrafficResetDisplay | null;
}) {
  return (
    <div
      className="card-metric-section traffic-quota"
      title={`流量阈值 · ${typeLabel}`}
    >
      <div className="traffic-quota-head">
        <TrafficQuotaLabel remainingLabel={remainingLabel} reset={reset} />
        <span className="traffic-quota-usage">{detail}</span>
      </div>
      <div className="traffic-quota-track" aria-hidden>
        {TRAFFIC_QUOTA_SEGMENT_COLORS.map((color, i) => {
          const background =
            litCount === -1 && i === 0
              ? `linear-gradient(to right, ${color} 0, ${color} ${TRAFFIC_SLIVER_RATIO * 100}%, var(--progress-bg) ${TRAFFIC_SLIVER_RATIO * 100}%, var(--progress-bg) 100%)`
              : i < litCount
                ? color
                : "var(--progress-bg)";
          return <span key={i} className="traffic-quota-segment" style={{ background }} />;
        })}
      </div>
    </div>
  );
});

const NodeHealthSection = memo(function NodeHealthSection({
  ping,
  pingBuckets,
  redrawKey,
  hasRealHomepagePingBinding,
  shouldRenderPingBars,
  pingLoading,
  pingError,
  latencyColor,
  lossColor,
}: {
  ping: PingOverviewItem;
  pingBuckets: PingOverviewBucket[];
  redrawKey: string;
  hasRealHomepagePingBinding: boolean;
  shouldRenderPingBars: boolean;
  pingLoading: boolean;
  pingError: boolean;
  latencyColor: string;
  lossColor: string;
}) {
  const [hoveredLatencyIndex, setHoveredLatencyIndex] = useState<number | null>(null);
  const [hoveredLossIndex, setHoveredLossIndex] = useState<number | null>(null);
  const onLatencyHover = useCallback((index: number | null) => {
    setHoveredLatencyIndex(index);
    if (index != null) setHoveredLossIndex(null);
  }, []);
  const onLossHover = useCallback((index: number | null) => {
    setHoveredLossIndex(index);
    if (index != null) setHoveredLatencyIndex(null);
  }, []);
  const { title: emptyTitle, text: emptyText } = pingEmptyLabels(
    hasRealHomepagePingBinding,
    pingLoading,
    pingError,
  );
  const hoveredLatencyBucket =
    hoveredLatencyIndex == null ? null : (pingBuckets[hoveredLatencyIndex] ?? null);
  const hoveredLossBucket =
    hoveredLossIndex == null ? null : (pingBuckets[hoveredLossIndex] ?? null);
  const latencyTooltip = hoveredLatencyBucket
    ? formatHealthBucketTooltip(hoveredLatencyBucket, "latency")
    : null;
  const lossTooltip = hoveredLossBucket
    ? formatHealthBucketTooltip(hoveredLossBucket, "loss")
    : null;
  const latencyLabel = ping.taskName?.trim() || "延迟";

  return (
    <div className="card-metric-section server-health-grid">
      <div className="server-health-block">
        <div className="server-health-head">
          <div className="server-health-label">
            <Clock3 size={13} strokeWidth={2} />
            <span title={latencyLabel}>{latencyLabel}</span>
          </div>
          <span
            className="server-health-value tabular"
            style={{ color: latencyColor }}
            title={
              pingError && ping.lastValue != null
                ? "首页 Ping 刷新失败，显示上次数据"
                : undefined
            }
          >
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
          {shouldRenderPingBars ? (
            <HealthBars
              kind="latency"
              buckets={pingBuckets}
              redrawKey={redrawKey}
              onHoverIndex={onLatencyHover}
            />
          ) : (
            <div className="server-health-placeholder">未配置首页 Ping</div>
          )}
          <HealthBucketTooltip
            text={latencyTooltip}
            index={hoveredLatencyIndex}
            count={pingBuckets.length}
          />
        </div>
      </div>
      <div className="server-health-block">
        <div className="server-health-head">
          <div className="server-health-label">
            <Unplug size={13} strokeWidth={2} />
            <span>丢包率</span>
          </div>
          <span
            className="server-health-value tabular"
            style={{ color: lossColor }}
            title={
              pingError && ping.loss != null
                ? "首页 Ping 刷新失败，显示上次数据"
                : undefined
            }
          >
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
          {shouldRenderPingBars ? (
            <HealthBars
              kind="loss"
              buckets={pingBuckets}
              redrawKey={redrawKey}
              onHoverIndex={onLossHover}
            />
          ) : (
            <div className="server-health-placeholder">未配置首页 Ping</div>
          )}
          <HealthBucketTooltip
            text={lossTooltip}
            index={hoveredLossIndex}
            count={pingBuckets.length}
          />
        </div>
      </div>
    </div>
  );
});

// 不设 title，让 hover 穿透到父轨道显示完整标签列表
function FooterTagChip({ tag }: { tag: DisplayTag }) {
  return (
    <span
      data-tag={tag.color}
      className="dstatus-tag-chip"
      style={{ background: "var(--tag-bg)", color: "var(--tag-fg)" }}
    >
      {tag.label}
    </span>
  );
}

function FooterPriceChip({ renewalPrice, titled }: { renewalPrice: string; titled?: boolean }) {
  return (
    <span
      className="dstatus-price-chip"
      title={titled ? `续费价格 ${renewalPrice}` : undefined}
    >
      <CircleDollarSign size={12} strokeWidth={2.2} />
      {renewalPrice}
    </span>
  );
}

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
  const tagTitle = joinTagTitle(footerTags);

  return (
    <div className="server-card-footer">
      <div className="server-card-meta-grid">
        <FooterStat
          icon={<RefreshCw size={13} strokeWidth={2} />}
          label="在线"
          value={uptime.value}
          unit={uptime.unit}
          color="var(--progress-cpu)"
        />
        <FooterStat
          icon={<Calendar size={13} strokeWidth={2} />}
          label="到期"
          value={expire.value}
          unit={expire.unit}
          color={expireColor}
        />
      </div>
      {(footerTags.length > 0 || renewalPrice) && (
        <div className="dstatus-tags-row">
          {footerTags.length > 0 && (
            <div className="dstatus-tags-lane" title={tagTitle}>
              {footerTags.map((tag, index) => (
                <FooterTagChip key={`${tag.label}-${index}`} tag={tag} />
              ))}
            </div>
          )}
          {renewalPrice && <FooterPriceChip renewalPrice={renewalPrice} titled />}
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
  active,
  redrawKey,
  color,
  icon,
}: {
  direction: "下行" | "上行";
  totalLabel: "入站" | "出站";
  rate: ByteRateDisplay;
  total: string;
  samples: TrafficTrendSample[];
  live: boolean;
  active: boolean;
  redrawKey: string;
  color: string;
  icon: ReactNode;
}) {
  const speedColor = speedRateColor(rate.unit);
  return (
    <div className="traffic-stat">
      <div className="traffic-stat-head">
        <div className="traffic-stat-label">
          <span style={{ color }}>{icon}</span>
          <span style={{ color: speedColor }}>{direction}</span>
        </div>
        <span className="traffic-stat-value tabular" style={{ color: speedColor }}>
          {rate.value}
          <span className="traffic-stat-unit">{rate.unit}</span>
        </span>
      </div>
      <div className="traffic-stat-trend">
        <TrafficDotStrip samples={samples} color={speedColor} redrawKey={redrawKey} />
        <span
          className="traffic-stat-live"
          data-live={live ? "true" : "false"}
          title={live ? (active ? "实时" : "空闲") : "离线"}
          aria-label={live ? (active ? "实时" : "空闲") : "离线"}
        >
          <span
            className="traffic-stat-live-dot"
            style={{
              background: speedColor,
            }}
          />
          {live && <span>{active ? "实时" : "空闲"}</span>}
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
  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, width: number, height: number) => {
      if (samples.length === 0) return;
      const slotWidth = width / samples.length;
      const baseColor = safeCanvasColor(color);
      const inactiveColor = safeCanvasColor("var(--progress-bg)");

      samples.forEach((sample, index) => {
        const hasTraffic = sample.value > 0;
        const scale = hasTraffic ? 0.72 + sample.level * 0.82 : 0.46;
        const radius = 2 * scale;
        const tone = hasTraffic
          ? safeCanvasColor(
              `color-mix(in srgb, ${baseColor} ${68 + sample.level * 20}%, white)`,
            )
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
