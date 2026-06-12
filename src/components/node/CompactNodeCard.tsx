import { memo, useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  ArrowDown,
  ArrowUp,
  Calendar,
  CircleDollarSign,
  Clock3,
  Cpu,
  Download,
  Gauge,
  HardDrive,
  MemoryStick,
  Upload,
  Unplug,
} from "lucide-react";
import { clsx } from "clsx";
import { Flag } from "@/components/ui/Flag";
import { OsLogo } from "@/components/ui/OsLogo";
import { useNodeCardModel } from "@/hooks/useNodeCardModel";
import { useThemeSettings } from "@/hooks/useThemeSettings";
import {
  formatBytes,
  trimFixed,
} from "@/utils/format";
import { latencyHeatColor, lossHeatColor } from "@/utils/metricTone";
import { formatHealthBucketTooltip } from "./pingBucketText";
import { nodeDetailLinkLabels } from "./nodeCardShared";
import type {
  NodeInfo,
  NodeMetrics,
  PingOverviewBucket,
  PingOverviewItem,
  TrafficTrendSample,
} from "@/types/komari";
import type { TrafficRateDisplay } from "@/utils/format";

const TRAFFIC_DOT_COUNT = 16;
const HEALTH_BAR_COUNT = 18;
const HARDWARE_BAR_COUNT = 18;
type CompactNode = NodeInfo & NodeMetrics;
type CompactTag = { label: string; color: string };
type CompactExpire = { value: string; unit: string };

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function formatCompactPercent(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0%";
  if (value >= 10) return `${Math.round(value)}%`;
  return `${trimFixed(value, 1)}%`;
}

function CompactGauge({
  icon,
  label,
  value,
  detail,
  color,
  fraction,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail?: string;
  color: string;
  fraction: number;
}) {
  const activeSegments = clamp01(fraction) * HARDWARE_BAR_COUNT;
  const style = { "--compact-gauge-color": color } as CSSProperties;

  return (
    <div
      className="compact-node-gauge"
      style={style}
      title={detail ? `${label} ${value} · ${detail}` : `${label} ${value}`}
    >
      <div className="compact-node-gauge-head">
        <span className="compact-node-gauge-label">
          {icon}
          <span>{label}</span>
        </span>
        <strong className="tabular">{value}</strong>
      </div>
      <div className="compact-node-gauge-track" aria-hidden>
        {Array.from({ length: HARDWARE_BAR_COUNT }, (_, index) => {
          const fillLevel = Math.max(0, Math.min(1, activeSegments - index));
          const active = fillLevel > 0;
          return (
            <span
              key={index}
              data-active={active ? "true" : "false"}
              style={
                active
                  ? ({ "--compact-segment-alpha": `${0.42 + fillLevel * 0.54}` } as CSSProperties)
                  : undefined
              }
            />
          );
        })}
      </div>
    </div>
  );
}

function CompactInfoTile({
  label,
  color,
  children,
}: {
  label: string;
  color: string;
  children: ReactNode;
}) {
  const style = { "--compact-info-color": color } as CSSProperties;

  return (
    <div
      className="compact-node-info-tile"
      style={style}
      aria-label={label}
    >
      <span className="compact-node-info-content">{children}</span>
    </div>
  );
}

function CompactTrafficPulse({
  up,
  down,
}: {
  up: TrafficTrendSample[];
  down: TrafficTrendSample[];
}) {
  const upSelected = up.slice(-TRAFFIC_DOT_COUNT);
  const downSelected = down.slice(-TRAFFIC_DOT_COUNT);
  const upPadding = Math.max(0, TRAFFIC_DOT_COUNT - upSelected.length);
  const downPadding = Math.max(0, TRAFFIC_DOT_COUNT - downSelected.length);

  return (
    <span className="compact-node-traffic-pulse" aria-hidden>
      {Array.from({ length: TRAFFIC_DOT_COUNT }, (_, index) => {
        const upSample = index < upPadding ? null : upSelected[index - upPadding];
        const downSample = index < downPadding ? null : downSelected[index - downPadding];
        const upValue = upSample?.value ?? 0;
        const downValue = downSample?.value ?? 0;
        const active = upValue > 0 || downValue > 0;
        const level = Math.max(upSample?.level ?? 0, downSample?.level ?? 0);
        const color = downValue >= upValue ? "var(--status-success)" : "var(--progress-cpu)";
        const style = {
          "--compact-traffic-dot-color": active ? color : "var(--progress-bg)",
          "--compact-traffic-dot-scale": active ? `${0.68 + level * 0.62}` : "0.48",
          "--compact-traffic-dot-delay": `${index * 42}ms`,
          opacity: active ? 0.5 + level * 0.42 : 0.38,
        } as CSSProperties;

        return (
          <span
            key={index}
            data-active={active ? "true" : "false"}
            style={style}
          />
        );
      })}
    </span>
  );
}

function CompactInfoRow({
  icon,
  label,
  value,
  unit,
  color,
}: {
  icon: ReactNode;
  label?: string;
  value: string;
  unit?: string;
  color?: string;
}) {
  const style = color ? ({ "--compact-info-row-color": color } as CSSProperties) : undefined;

  return (
    <span className="compact-node-info-row" style={style}>
      <span className="compact-node-info-row-label">
        {icon}
        {label && <span>{label}</span>}
      </span>
      <strong className="compact-node-info-row-value tabular">
        {value}
        {unit && <small>{unit}</small>}
      </strong>
    </span>
  );
}

function formatCompactExpire({
  value,
  unit,
}: {
  value: string;
  unit: string;
}) {
  if (value === "—") return "余 --";
  return unit ? `余 ${value}${unit}` : value;
}

function HealthBars({
  buckets,
  max,
  kind,
}: {
  buckets: PingOverviewBucket[];
  max: number;
  kind: "latency" | "loss";
}) {
  const safeMax = Math.max(1, max);
  const bars = buckets.slice(-HEALTH_BAR_COUNT);
  const containerRef = useRef<HTMLDivElement>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const activeIndex = hoveredIndex ?? selectedIndex;
  const activeBucket = activeIndex == null ? null : bars[activeIndex] ?? null;
  const activeTooltip = activeBucket ? formatHealthBucketTooltip(activeBucket, kind) : null;
  const activeLeft =
    activeIndex == null || bars.length === 0
      ? "50%"
      : `clamp(42px, ${((activeIndex + 0.5) / bars.length) * 100}%, calc(100% - 42px))`;

  useEffect(() => {
    if (selectedIndex == null) return;

    const clearWhenOutside = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && containerRef.current?.contains(target)) {
        return;
      }
      setSelectedIndex(null);
    };

    document.addEventListener("pointerdown", clearWhenOutside);
    return () => document.removeEventListener("pointerdown", clearWhenOutside);
  }, [selectedIndex]);

  return (
    <div
      ref={containerRef}
      className="compact-node-health-bars"
      data-kind={kind}
      style={{ "--compact-health-tooltip-x": activeLeft } as CSSProperties}
    >
      {activeTooltip && (
        <span className="compact-node-health-tooltip" role="status">
          {activeTooltip}
        </span>
      )}
      {bars.map((bucket, index) => {
        const hasSamples = bucket.total > 0;
        const latencyValue = bucket.value ?? 0;
        const lossValue = bucket.loss ?? 0;
        const active = kind === "latency" ? hasSamples && latencyValue > 0 : hasSamples;
        const height =
          kind === "latency"
            ? `${active ? Math.max(26, Math.min(100, (latencyValue / safeMax) * 100)) : 24}%`
            : `${active ? Math.max(38, Math.min(100, 84 - Math.min(lossValue, 45))) : 24}%`;
        const color = active
          ? kind === "latency"
            ? latencyHeatColor(latencyValue)
            : lossHeatColor(lossValue)
          : "var(--progress-bg)";
        const style = {
          "--compact-health-height": height,
          "--compact-health-color": color,
          opacity: active ? 0.94 : 0.42,
        } as CSSProperties;
        const tooltip = formatHealthBucketTooltip(bucket, kind);

        return (
          <button
            key={`${bucket.index}-${index}`}
            type="button"
            className="compact-node-health-bar"
            style={style}
            data-selected={selectedIndex === index ? "true" : "false"}
            aria-label={`${kind === "latency" ? "延迟" : "丢包"} ${tooltip}`}
            title={tooltip}
            onMouseEnter={() => setHoveredIndex(index)}
            onMouseLeave={() => setHoveredIndex(null)}
            onFocus={() => setHoveredIndex(index)}
            onBlur={() => setHoveredIndex(null)}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setSelectedIndex((current) => (current === index ? null : index));
            }}
          />
        );
      })}
    </div>
  );
}

function CompactHealthItem({
  icon,
  label,
  value,
  unit,
  color,
  children,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  unit?: string;
  color: string;
  children: ReactNode;
}) {
  return (
    <div className="compact-node-health-item">
      <div className="compact-node-health-head">
        <span className="compact-node-health-label">
          {icon}
          {label}
        </span>
        <strong className="compact-node-health-value tabular" style={{ color }}>
          {value}
          {unit && <small>{unit}</small>}
        </strong>
      </div>
      {children}
    </div>
  );
}

function CompactNodeHeader({
  node,
  osName,
}: {
  node: CompactNode;
  osName: string;
}) {
  const detailLabels = nodeDetailLinkLabels(node.name, osName);
  return (
    <header className="compact-node-header">
      <div className="compact-node-title-wrap">
        <div className="compact-node-title-row">
          <Flag region={node.region} size={15} />
          <Link
            to={`/instance/${node.uuid}`}
            className="compact-node-title"
            title={node.name}
          >
            {node.name}
          </Link>
        </div>
      </div>
      <div className="compact-node-actions">
        <Link
          to={`/instance/${node.uuid}`}
          className="compact-node-detail-link"
          title={detailLabels.title}
          aria-label={detailLabels.ariaLabel}
        >
          <OsLogo value={node.os} size={15} />
        </Link>
      </div>
    </header>
  );
}

function CompactNodeChips({
  subtitle,
  visibleTags,
  hiddenTagCount,
  hiddenTagTitle,
}: {
  subtitle: string;
  visibleTags: CompactTag[];
  hiddenTagCount: number;
  hiddenTagTitle: string;
}) {
  return (
    <div className="compact-node-chip-row">
      {subtitle && (
        <span className="compact-node-subtitle" title={subtitle}>
          {subtitle}
        </span>
      )}
      {visibleTags.map((tag, index) => (
        <span
          key={`${tag.label}-${index}`}
          className="compact-node-tag"
          data-tag={tag.color}
          title={tag.label}
        >
          {tag.label}
        </span>
      ))}
      {hiddenTagCount > 0 && (
        <span className="compact-node-tag compact-node-tag-more" title={hiddenTagTitle}>
          +{hiddenTagCount}
        </span>
      )}
    </div>
  );
}

function CompactNodeVitals({
  node,
  loadBaseline,
}: {
  node: CompactNode;
  loadBaseline: number;
}) {
  return (
    <div className="compact-node-vitals">
      <CompactGauge
        icon={<Cpu size={12} />}
        label="CPU"
        value={formatCompactPercent(node.cpuPct)}
        detail={`${node.cpu_cores || 0} 核`}
        fraction={node.cpuPct / 100}
        color="var(--progress-cpu)"
      />
      <CompactGauge
        icon={<MemoryStick size={12} />}
        label="内存"
        value={formatCompactPercent(node.ramPct)}
        detail={`${formatBytes(node.ramUsed)} / ${formatBytes(node.ramTotal)}`}
        fraction={node.ramPct / 100}
        color="var(--progress-memory)"
      />
      <CompactGauge
        icon={<HardDrive size={12} />}
        label="磁盘"
        value={formatCompactPercent(node.diskPct)}
        detail={`${formatBytes(node.diskUsed)} / ${formatBytes(node.diskTotal)}`}
        fraction={node.diskPct / 100}
        color="var(--progress-disk)"
      />
      <CompactGauge
        icon={<Gauge size={12} />}
        label="负载"
        value={node.load1.toFixed(2)}
        detail={`${node.load5.toFixed(2)} / ${node.load15.toFixed(2)}`}
        fraction={node.load1 / loadBaseline}
        color="var(--progress-network)"
      />
    </div>
  );
}

function CompactNodeInfoStrip({
  node,
  trafficTrend,
  upRate,
  downRate,
  showTrafficTotal,
  showBilling,
  expire,
  expireColor,
  renewalPrice,
}: {
  node: CompactNode;
  trafficTrend: { up: TrafficTrendSample[]; down: TrafficTrendSample[] };
  upRate: TrafficRateDisplay;
  downRate: TrafficRateDisplay;
  showTrafficTotal: boolean;
  showBilling: boolean;
  expire: CompactExpire;
  expireColor: string;
  renewalPrice: string | null;
}) {
  const infoTileCount = 1 + (showTrafficTotal ? 1 : 0) + (showBilling ? 1 : 0);

  return (
    <div
      className="compact-node-info-strip"
      style={{ "--compact-info-columns": infoTileCount } as CSSProperties}
    >
      <CompactInfoTile
        label="实时速率"
        color="var(--progress-cpu)"
      >
        <CompactInfoRow
          icon={<ArrowUp size={12} strokeWidth={2.3} />}
          value={upRate.value}
          unit={upRate.unit}
          color="var(--progress-cpu)"
        />
        <CompactInfoRow
          icon={<ArrowDown size={12} strokeWidth={2.3} />}
          value={downRate.value}
          unit={downRate.unit}
          color="var(--status-success)"
        />
        <CompactTrafficPulse up={trafficTrend.up} down={trafficTrend.down} />
      </CompactInfoTile>
      {showTrafficTotal && (
        <CompactInfoTile
          label="累计流量"
          color="var(--text-secondary)"
        >
          <CompactInfoRow
            icon={<Upload size={12} strokeWidth={2.1} />}
            value={formatBytes(node.trafficUp)}
          />
          <CompactInfoRow
            icon={<Download size={12} strokeWidth={2.1} />}
            value={formatBytes(node.trafficDown)}
          />
        </CompactInfoTile>
      )}
      {showBilling && (
        <CompactInfoTile
          label="费用到期"
          color="var(--status-success)"
        >
          <CompactInfoRow
            icon={<Calendar size={12} strokeWidth={2.1} />}
            value={formatCompactExpire(expire)}
            color={expireColor}
          />
          <CompactInfoRow
            icon={<CircleDollarSign size={12} strokeWidth={2.2} />}
            value={renewalPrice || "未填"}
            color={renewalPrice ? "var(--status-success)" : "var(--text-tertiary)"}
          />
        </CompactInfoTile>
      )}
    </div>
  );
}

function CompactNodeHealth({
  ping,
  pingBuckets,
  latencyColor,
  lossColor,
  hasHomepagePingBinding,
}: {
  ping: PingOverviewItem;
  pingBuckets: PingOverviewBucket[];
  latencyColor: string;
  lossColor: string;
  hasHomepagePingBinding: boolean;
}) {
  // A node with a homepage Ping binding but no successful samples yet shows
  // "无样本" (no samples), not "未配置" (unconfigured) — same distinction NodeCard
  // makes via hasHomepagePingBinding.
  const emptyText = hasHomepagePingBinding ? "无样本" : "未配置";
  return (
    <div className="compact-node-bottom">
      <CompactHealthItem
        icon={<Clock3 size={12} />}
        label="延迟"
        value={ping.lastValue != null ? Math.round(ping.lastValue).toString() : emptyText}
        unit={ping.lastValue != null ? "ms" : undefined}
        color={latencyColor}
      >
        <HealthBars buckets={pingBuckets} max={ping.max} kind="latency" />
      </CompactHealthItem>
      <CompactHealthItem
        icon={<Unplug size={12} />}
        label="丢包"
        value={ping.loss != null ? ping.loss.toFixed(1) : emptyText}
        unit={ping.loss != null ? "%" : undefined}
        color={lossColor}
      >
        <HealthBars buckets={pingBuckets} max={1} kind="loss" />
      </CompactHealthItem>
    </div>
  );
}

export const CompactNodeCard = memo(function CompactNodeCard({
  uuid,
}: {
  uuid: string;
}) {
  const model = useNodeCardModel(uuid, HEALTH_BAR_COUNT);
  const themeSettings = useThemeSettings();

  if (!model.node) {
    return <div className="compact-node-card animate-pulse" aria-busy />;
  }

  const {
    node,
    trafficTrend,
    ping,
    pingBuckets,
    compactFooterTags: footerTags,
    subtitle,
    renewalPrice,
    expire,
    expireColor,
    upRate,
    downRate,
    isOffline,
    latencyColor,
    lossColor,
    loadBaseline,
    hasHomepagePingBinding,
    osName,
  } = model;
  const visibleTagLimit = subtitle ? 2 : 3;
  const visibleTags = footerTags.slice(0, visibleTagLimit);
  const hiddenTagCount = Math.max(0, footerTags.length - visibleTags.length);
  const hiddenTagTitle = footerTags
    .slice(visibleTags.length)
    .map((tag) => tag.label)
    .join(" / ");
  const showTrafficTotal = themeSettings.compactShowTrafficTotal;
  const showBilling = themeSettings.compactShowBilling;

  return (
    <article className={clsx("compact-node-card", isOffline && "is-offline")}>
      <CompactNodeHeader node={node} osName={osName} />
      <CompactNodeChips
        subtitle={subtitle}
        visibleTags={visibleTags}
        hiddenTagCount={hiddenTagCount}
        hiddenTagTitle={hiddenTagTitle}
      />
      <CompactNodeVitals node={node} loadBaseline={loadBaseline} />
      <CompactNodeInfoStrip
        node={node}
        trafficTrend={trafficTrend}
        upRate={upRate}
        downRate={downRate}
        showTrafficTotal={showTrafficTotal}
        showBilling={showBilling}
        expire={expire}
        expireColor={expireColor}
        renewalPrice={renewalPrice}
      />
      <CompactNodeHealth
        ping={ping}
        pingBuckets={pingBuckets}
        latencyColor={latencyColor}
        lossColor={lossColor}
        hasHomepagePingBinding={hasHomepagePingBinding}
      />
    </article>
  );
});
