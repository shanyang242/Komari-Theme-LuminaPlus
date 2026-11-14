import { memo, useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  ArrowDown,
  ArrowUp,
  CircleDollarSign,
  Clock3,
  Cpu,
  Gauge,
  HardDrive,
  MemoryStick,
  Unplug,
} from "lucide-react";
import { clsx } from "clsx";
import { Flag } from "@/components/ui/Flag";
import { OsLogo } from "@/components/ui/OsLogo";
import { IpStackBadges } from "./IpStackBadges";
import { NodeTodayTrafficPopover } from "./NodeTodayTrafficPopover";
import { MerchantLinkAction } from "./MerchantLinkAction";
import { HealthBucketTooltip } from "./HealthBucketTooltip";
import { useNodeCardModel } from "@/hooks/useNodeCardModel";
import { useThemeSettings } from "@/hooks/useThemeSettings";
import { speedRateColor } from "@/utils/metricTone";
import { supportsFineHover } from "@/utils/mediaQuery";
import {
  healthBarSlotModel,
  joinTagTitle,
  nodeDetailLinkLabels,
  pingEmptyLabels,
} from "./nodeCardShared";
import { formatHealthBucketTooltip } from "./pingBucketText";
import { formatBytes, type ByteRateDisplay } from "@/utils/format";
import type { NodeMerchantLink } from "@/utils/merchantLinks";
import type { NodeInfo, NodeMetrics, PingOverviewItem, PingOverviewBucket } from "@/types/komari";

// 迷你卡固定为巡检布局，不跟随紧凑卡的可选指标开关；数据仍走共享模型。
const HEALTH_BAR_COUNT = 24;

type MiniNode = NodeInfo & NodeMetrics;
type MiniTag = { label: string; color: string };

function MiniHeader({
  node,
  osName,
  showMerchantLink,
  merchantLink,
  showTodayTraffic,
}: {
  node: MiniNode;
  osName: string;
  showMerchantLink: boolean;
  merchantLink?: NodeMerchantLink;
  showTodayTraffic: boolean;
}) {
  const detailLabels = nodeDetailLinkLabels(node.name, osName);
  const detailHref = `/instance/${encodeURIComponent(node.uuid)}`;
  return (
    <header className="mini-node-header">
      <Flag region={node.region} size={14} />
      <Link to={detailHref} className="mini-node-title" title={node.name}>
        {node.name}
      </Link>
      {showMerchantLink && (
        <MerchantLinkAction
          link={merchantLink}
          className="mini-node-os"
          size={13}
        />
      )}
      {showTodayTraffic && <NodeTodayTrafficPopover uuid={node.uuid} size={13} />}
      <Link
        to={detailHref}
        className="mini-node-os"
        title={detailLabels.title}
        aria-label={detailLabels.ariaLabel}
      >
        <OsLogo value={node.os} size={14} />
      </Link>
    </header>
  );
}

// 价格保底 chip 排最前；标签放不下时整枚隐藏，完整列表保留在 tooltip。
function MiniChips({
  tags,
  renewalPrice,
  ipv4,
  ipv6,
}: {
  tags: MiniTag[];
  renewalPrice: string | null;
  ipv4?: string | null;
  ipv6?: string | null;
}) {
  if (!renewalPrice && tags.length === 0 && !ipv4 && !ipv6) return null;
  const tagTitle = joinTagTitle(tags);
  return (
    <div className="mini-node-chip-row">
      {renewalPrice && (
        <span className="mini-node-price-tag" title={`续费价格 ${renewalPrice}`}>
          <CircleDollarSign size={11} strokeWidth={2.2} />
          {renewalPrice}
        </span>
      )}
      <IpStackBadges ipv4={ipv4} ipv6={ipv6} />
      {tags.length > 0 && (
        <div className="mini-node-tag-lane" title={tagTitle}>
          {tags.map((tag, index) => (
            <span key={`${tag.label}-${index}`} className="mini-node-tag" data-tag={tag.color}>
              {tag.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

type MiniMetricStyle = CSSProperties & {
  "--mini-metric-fill": string;
  "--mini-metric-color": string;
};

function MiniMetricBar({
  icon,
  label,
  valueText,
  unit,
  fraction,
  paint,
}: {
  icon: ReactNode;
  label: string;
  valueText: string;
  unit?: string;
  fraction: number;
  paint: string;
}) {
  const clamped = Math.max(0, Math.min(1, fraction));
  const fullValue = `${valueText}${unit ?? ""}`;
  const style: MiniMetricStyle = {
    "--mini-metric-fill": `${clamped * 100}%`,
    "--mini-metric-color": paint,
  };

  return (
    <div className="metric-item">
      <div className="mini-metric-head">
        <span className="mini-metric-label">
          {icon}
          {label}
        </span>
        <span className="mini-metric-value tabular" title={`${label} ${fullValue}`}>
          <strong>{valueText}</strong>
          {unit && <small>{unit}</small>}
        </span>
      </div>
      <span className="mini-metric-track" style={style} aria-hidden />
    </div>
  );
}

function MiniVitals({
  node,
  loadFraction,
}: {
  node: MiniNode;
  loadFraction: number;
}) {
  return (
    <div className="mini-node-vitals">
      <MiniMetricBar
        icon={<Cpu size={12} strokeWidth={2} />}
        label="CPU"
        valueText={node.cpuPct.toFixed(node.cpuPct >= 10 ? 0 : 1)}
        unit="%"
        fraction={node.cpuPct / 100}
        paint="var(--progress-cpu)"
      />
      <MiniMetricBar
        icon={<MemoryStick size={12} strokeWidth={2} />}
        label="内存"
        valueText={node.ramPct.toFixed(node.ramPct >= 10 ? 0 : 1)}
        unit="%"
        fraction={node.ramPct / 100}
        paint="var(--progress-memory)"
      />
      <MiniMetricBar
        icon={<HardDrive size={12} strokeWidth={2} />}
        label="磁盘"
        valueText={node.diskPct.toFixed(node.diskPct >= 10 ? 0 : 1)}
        unit="%"
        fraction={node.diskPct / 100}
        paint="var(--progress-disk)"
      />
      <MiniMetricBar
        icon={<Gauge size={12} strokeWidth={2} />}
        label="负载"
        valueText={node.load1.toFixed(2)}
        fraction={loadFraction}
        paint="var(--progress-load)"
      />
    </div>
  );
}

function MiniFlowRow({
  icon,
  value,
  unit,
  color,
  title,
}: {
  icon: ReactNode;
  value: string;
  unit?: string;
  color?: string;
  title: string;
}) {
  return (
    <span
      className="mini-node-flow-row"
      style={color ? { color } : undefined}
      title={title}
      aria-label={`${title} ${value}${unit ?? ""}`}
    >
      <span className="mini-node-flow-arrow">{icon}</span>
      <strong className="tabular">
        {value}
        {unit && <small>{unit}</small>}
      </strong>
    </span>
  );
}

// 左栏集中显示实时速率，右栏集中显示累计流量；每栏均按上行、下行排列。
function MiniFlow({
  node,
  upRate,
  downRate,
}: {
  node: MiniNode;
  upRate: ByteRateDisplay;
  downRate: ByteRateDisplay;
}) {
  return (
    <div className="mini-node-flow">
      <div className="mini-node-flow-group" aria-label="实时网速">
        <MiniFlowRow
          icon={<ArrowUp size={12} strokeWidth={2.4} />}
          value={upRate.value}
          unit={upRate.unit}
          color={speedRateColor(upRate.unit)}
          title="实时上行"
        />
        <MiniFlowRow
          icon={<ArrowDown size={12} strokeWidth={2.4} />}
          value={downRate.value}
          unit={downRate.unit}
          color={speedRateColor(downRate.unit)}
          title="实时下行"
        />
      </div>
      <div className="mini-node-flow-group" aria-label="累计流量">
        <MiniFlowRow
          icon={<ArrowUp size={12} strokeWidth={2.2} />}
          value={formatBytes(node.trafficUp)}
          title="累计上行"
        />
        <MiniFlowRow
          icon={<ArrowDown size={12} strokeWidth={2.2} />}
          value={formatBytes(node.trafficDown)}
          title="累计下行"
        />
      </div>
    </div>
  );
}

function MiniHealthBars({
  buckets,
  kind,
}: {
  buckets: PingOverviewBucket[];
  kind: "latency" | "loss";
}) {
  const width = Math.max(1, buckets.length * 4 - 1);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const hoveredBucket = hoveredIndex == null ? null : (buckets[hoveredIndex] ?? null);
  const tooltip = hoveredBucket ? formatHealthBucketTooltip(hoveredBucket, kind) : null;

  return (
    <div className="mini-health-chart-wrap">
      <svg
        className="mini-health-bars"
        viewBox={`0 0 ${width} 16`}
        preserveAspectRatio="none"
        aria-hidden
        onPointerMove={(event) => {
          if (!supportsFineHover(event.pointerType)) {
            setHoveredIndex(null);
            return;
          }
          const rect = event.currentTarget.getBoundingClientRect();
          if (rect.width <= 0 || buckets.length === 0) return;
          const ratio = (event.clientX - rect.left) / rect.width;
          setHoveredIndex(Math.max(0, Math.min(buckets.length - 1, Math.floor(ratio * buckets.length))));
        }}
        onPointerLeave={() => setHoveredIndex(null)}
      >
        {buckets.map((bucket, index) => {
          const slot = healthBarSlotModel(bucket, kind);
          const barHeight = 16 * slot.heightFraction;

          return (
            <rect
              key={bucket.index}
              className="mini-health-bar"
              x={index * 4}
              y={16 - barHeight}
              width="3"
              height={barHeight}
              rx="1.25"
              fill={slot.color}
              opacity={slot.alpha}
            />
          );
        })}
      </svg>
      <HealthBucketTooltip text={tooltip} index={hoveredIndex} count={buckets.length} />
    </div>
  );
}

// 延迟/丢包必显；mini 使用内联 SVG，避免每张卡创建 Canvas 与观察器。
const MiniHealth = memo(function MiniHealth({
  ping,
  pingBuckets,
  latencyColor,
  lossColor,
  hasRealHomepagePingBinding,
  pingLoading,
  pingError,
}: {
  ping: PingOverviewItem;
  pingBuckets: PingOverviewBucket[];
  latencyColor: string;
  lossColor: string;
  hasRealHomepagePingBinding: boolean;
  pingLoading: boolean;
  pingError: boolean;
}) {
  const { text: emptyText } = pingEmptyLabels(
    hasRealHomepagePingBinding,
    pingLoading,
    pingError,
  );
  return (
    <div
      className="mini-node-health"
      data-ping-state={ping.loadState ?? "ready"}
      title={
        pingError && (ping.lastValue != null || ping.loss != null)
          ? "首页 Ping 刷新失败，显示上次数据"
          : undefined
      }
    >
      <div className="mini-node-health-item">
        <div className="mini-node-health-head">
          <span className="mini-node-health-label">
            <Clock3 size={12} strokeWidth={2} />
            延迟
          </span>
          <strong className="mini-node-health-value tabular" style={{ color: latencyColor }}>
            {ping.lastValue != null ? (
              <>
                {Math.round(ping.lastValue)}
                <small>ms</small>
              </>
            ) : (
              <span className="mini-node-health-empty">{emptyText}</span>
            )}
          </strong>
        </div>
        <MiniHealthBars kind="latency" buckets={pingBuckets} />
      </div>
      <div className="mini-node-health-item">
        <div className="mini-node-health-head">
          <span className="mini-node-health-label">
            <Unplug size={12} strokeWidth={2} />
            丢包
          </span>
          <strong className="mini-node-health-value tabular" style={{ color: lossColor }}>
            {ping.loss != null ? (
              <>
                {ping.loss.toFixed(1)}
                <small>%</small>
              </>
            ) : (
              <span className="mini-node-health-empty">{emptyText}</span>
            )}
          </strong>
        </div>
        <MiniHealthBars kind="loss" buckets={pingBuckets} />
      </div>
    </div>
  );
});

export const MiniNodeCard = memo(function MiniNodeCard({
  uuid,
  showTodayTraffic = true,
  showCosts = true,
}: {
  uuid: string;
  showTodayTraffic?: boolean;
  showCosts?: boolean;
}) {
  const model = useNodeCardModel(uuid, {
    pingBucketCount: HEALTH_BAR_COUNT,
  });
  const themeSettings = useThemeSettings();

  if (!model.node) {
    return <article className="mini-node-card animate-pulse" aria-busy />;
  }

  const {
    node,
    ping,
    pingBuckets,
    footerTags,
    renewalPrice,
    latencyColor,
    lossColor,
    loadFraction,
    upRate,
    downRate,
    hasRealHomepagePingBinding,
    pingLoading,
    pingError,
    isOffline,
    osName,
  } = model;
  const showMerchantLink = themeSettings.isReady && themeSettings.showMerchantLinks;

  return (
    <article className={clsx("mini-node-card", isOffline && "is-offline")}>
      <MiniHeader
        node={node}
        osName={osName}
        showMerchantLink={showMerchantLink}
        merchantLink={themeSettings.nodeMerchantLinks[node.uuid]}
        showTodayTraffic={showTodayTraffic}
      />
      <MiniChips
        tags={footerTags}
        renewalPrice={showCosts ? renewalPrice : null}
        ipv4={node.ipv4}
        ipv6={node.ipv6}
      />
      <MiniVitals node={node} loadFraction={loadFraction} />
      <MiniFlow node={node} upRate={upRate} downRate={downRate} />
      <MiniHealth
        ping={ping}
        pingBuckets={pingBuckets}
        latencyColor={latencyColor}
        lossColor={lossColor}
        hasRealHomepagePingBinding={hasRealHomepagePingBinding}
        pingLoading={pingLoading}
        pingError={pingError}
      />
    </article>
  );
});
