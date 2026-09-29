import { memo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  ArrowDown,
  ArrowUp,
  Calendar,
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
import { useNodeCardModel } from "@/hooks/useNodeCardModel";
import { useThemeSettings } from "@/hooks/useThemeSettings";
import { formatBytes } from "@/utils/format";
import { speedRateColor, speedRateColorFromBytes } from "@/utils/metricTone";
import { supportsFineHover } from "@/utils/mediaQuery";
import { formatHealthBucketTooltip } from "./pingBucketText";
import {
  formatCompactExpire,
  formatCompactPercent,
  formatCompactUptime,
  healthBarSlotModel,
  joinTagTitle,
  nodeDetailLinkLabels,
  pingEmptyLabels,
  TRAFFIC_SLIVER_RATIO,
} from "./nodeCardShared";
import { IpStackBadges } from "./IpStackBadges";
import { TrafficQuotaLabel } from "./TrafficQuotaLabel";
import type { TrafficResetDisplay } from "@/utils/trafficReset";
import type {
  NodeInfo,
  NodeMetrics,
  PingOverviewBucket,
  PingOverviewItem,
  TrafficTrendSample,
} from "@/types/komari";
import type { ByteRateDisplay } from "@/utils/format";
import type { TrafficDisplay } from "@/utils/traffic";

const TRAFFIC_DOT_COUNT = 16;
const HEALTH_BAR_COUNT = 18;
type CompactNode = NodeInfo & NodeMetrics;
type CompactTag = { label: string; color: string };
type CompactExpire = { value: string; unit: string };

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
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
  // 单元素分段条:填充用一个 hard-stop 渐变到 fraction 处,再叠一个重复 mask 打出
  // 18 个段间空隙。替代了 18 个逐段 <span>(每卡 ×4 个 gauge)—— 那些 span 在每个
  // 屏外卡片上每 tick 的 reconcile + 样式重算曾是渲染开销大头。
  const style = {
    "--compact-gauge-color": color,
    "--compact-gauge-fill": `${clamp01(fraction) * 100}%`,
  } as CSSProperties;

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
      <div className="compact-node-gauge-track" aria-hidden />
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
        // 每点按其主方向(上/下取大)速率的单位档上色,与大卡的速度档色一致;大小/透明度仍按 level。
        // 仅活跃点计算颜色,空闲点直接用中性色,省掉无谓的 formatByteRate。
        const style = {
          "--compact-traffic-dot-color": active
            ? speedRateColorFromBytes(Math.max(upValue, downValue))
            : "var(--progress-bg)",
          "--compact-traffic-dot-scale": active ? `${0.68 + level * 0.62}` : "0.48",
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

function HealthBars({
  buckets,
  kind,
}: {
  buckets: PingOverviewBucket[];
  kind: "latency" | "loss";
}) {
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

  const selectIndex = (next: number) => {
    if (bars.length === 0) return;
    setSelectedIndex(Math.max(0, Math.min(bars.length - 1, next)));
  };

  return (
    <div
      ref={containerRef}
      className="compact-node-health-bars"
      data-kind={kind}
      style={{ "--compact-health-tooltip-x": activeLeft } as CSSProperties}
      tabIndex={0}
      role="group"
      aria-label={`${kind === "latency" ? "延迟" : "丢包"}历史${activeTooltip ? `，${activeTooltip}` : ""}，使用左右方向键查看`}
      onFocus={() => {
        if (!supportsFineHover()) return;
        if (selectedIndex == null) selectIndex(bars.length - 1);
      }}
      onBlur={() => {
        setHoveredIndex(null);
        setSelectedIndex(null);
      }}
      onKeyDown={(event) => {
        const current = selectedIndex ?? bars.length - 1;
        if (event.key === "ArrowLeft") selectIndex(current - 1);
        else if (event.key === "ArrowRight") selectIndex(current + 1);
        else if (event.key === "Home") selectIndex(0);
        else if (event.key === "End") selectIndex(bars.length - 1);
        else return;
        event.preventDefault();
      }}
    >
      {activeTooltip && (
        <span className="compact-node-health-tooltip" role="status">
          {activeTooltip}
        </span>
      )}
      {bars.map((bucket, index) => {
        const slot = healthBarSlotModel(bucket, kind);
        const style = {
          "--compact-health-height": `${slot.heightFraction * 100}%`,
          "--compact-health-color": slot.color,
          opacity: slot.alpha,
        } as CSSProperties;

        return (
          <span
            key={`${bucket.index}-${index}`}
            className="compact-node-health-bar"
            style={style}
            data-selected={selectedIndex === index ? "true" : "false"}
            aria-hidden="true"
            onPointerEnter={(event) => {
              if (supportsFineHover(event.pointerType)) setHoveredIndex(index);
            }}
            onPointerLeave={() => setHoveredIndex(null)}
            onClick={() => {
              if (!supportsFineHover()) return;
              containerRef.current?.focus({ preventScroll: true });
              setSelectedIndex(index);
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
        <span className="compact-node-health-label" title={label}>
          {icon}
          <span>{label}</span>
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
            to={`/instance/${encodeURIComponent(node.uuid)}`}
            className="compact-node-title"
            title={node.name}
          >
            {node.name}
          </Link>
        </div>
      </div>
      <div className="compact-node-actions">
        <Link
          to={`/instance/${encodeURIComponent(node.uuid)}`}
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
  tags,
  ipv4,
  ipv6,
}: {
  subtitle: string;
  tags: CompactTag[];
  ipv4?: string | null;
  ipv6?: string | null;
}) {
  // 完整 tag 列表挂在 lane 的 tooltip 上;chip 不带自己的 title,hover 会穿透到 lane 上 ——
  // 被裁剪 lane 折行挤出去的 tag 就靠这个保持可见,不用显示"+N"角标。
  const tagTitle = joinTagTitle(tags);

  return (
    <div className="compact-node-chip-row">
      {subtitle && (
        <span className="compact-node-subtitle" title={subtitle}>
          {subtitle}
        </span>
      )}
      <IpStackBadges ipv4={ipv4} ipv6={ipv6} />
      {tags.length > 0 && (
        <div className="compact-node-tag-lane" title={tagTitle}>
          {tags.map((tag, index) => (
            <span
              key={`${tag.label}-${index}`}
              className="compact-node-tag"
              data-tag={tag.color}
            >
              {tag.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function CompactNodeVitals({
  node,
  loadFraction,
}: {
  node: CompactNode;
  loadFraction: number;
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
        fraction={loadFraction}
        color="var(--progress-load)"
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
  showCosts,
  expire,
  expireColor,
  renewalPrice,
}: {
  node: CompactNode;
  trafficTrend: { up: TrafficTrendSample[]; down: TrafficTrendSample[] };
  upRate: ByteRateDisplay;
  downRate: ByteRateDisplay;
  showTrafficTotal: boolean;
  showBilling: boolean;
  showCosts: boolean;
  expire: CompactExpire;
  expireColor: string;
  renewalPrice: string | null;
}) {
  const infoTileCount =
    1 + (showTrafficTotal ? 1 : 0) + (showBilling ? 1 : 0);

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
          color={speedRateColor(upRate.unit)}
        />
        <CompactInfoRow
          icon={<ArrowDown size={12} strokeWidth={2.3} />}
          value={downRate.value}
          unit={downRate.unit}
          color={speedRateColor(downRate.unit)}
        />
        <CompactTrafficPulse up={trafficTrend.up} down={trafficTrend.down} />
      </CompactInfoTile>
      {showTrafficTotal && (
        <CompactInfoTile
          label="累计流量"
          color="var(--text-primary)"
        >
          <CompactInfoRow
            icon={(
              <ArrowUp
                size={12}
                strokeWidth={2.5}
                aria-label="上行"
              />
            )}
            value={formatBytes(node.trafficUp)}
          />
          <CompactInfoRow
            icon={(
              <ArrowDown
                size={12}
                strokeWidth={2.5}
                aria-label="下行"
              />
            )}
            value={formatBytes(node.trafficDown)}
          />
        </CompactInfoTile>
      )}
      {showBilling && (
        <CompactInfoTile
          label={showCosts ? "费用到期" : "到期"}
          color="var(--status-success)"
        >
          <CompactInfoRow
            icon={<Calendar size={12} strokeWidth={2.1} />}
            value={formatCompactExpire(expire)}
            color={expireColor}
          />
          {showCosts && (
            <CompactInfoRow
              icon={<CircleDollarSign size={12} strokeWidth={2.2} />}
              value={renewalPrice || "未填"}
              color={renewalPrice ? "var(--status-success)" : "var(--text-tertiary)"}
            />
          )}
        </CompactInfoTile>
      )}
    </div>
  );
}

// 流量阈值条:label + used / limit 同一行(紧凑卡片很挤,这里省掉剩余量),
// 用单元素热力填充(无 canvas、无逐段 span)复用 gauge 轨道,保持每 tick 低开销。
function CompactTrafficBar({
  traffic,
  uptimeLabel,
  reset,
}: {
  traffic: TrafficDisplay;
  uptimeLabel: string;
  reset: TrafficResetDisplay | null;
}) {
  // 用量非零但极小时,下限填充"一段的 TRAFFIC_SLIVER_RATIO"(段内一道细边),而不是整段——
  // 否则低用量节点(如 0.01%)会被夸张成快 5.6%。fraction 为 0 时保持全灭。
  const fillFraction =
    traffic.fraction > 0
      ? Math.max(clamp01(traffic.fraction), TRAFFIC_SLIVER_RATIO / 18)
      : 0;
  const style = {
    "--compact-gauge-color": traffic.color,
    "--compact-gauge-fill": `${fillFraction * 100}%`,
  } as CSSProperties;

  return (
    <div
      className="compact-node-traffic"
      style={style}
      title={`流量 · ${traffic.typeLabel} · ${traffic.detail}${uptimeLabel ? ` · ${uptimeLabel}` : ""}`}
    >
      <div className={clsx("compact-node-traffic-body", uptimeLabel && "has-uptime")}>
        <div className="compact-node-traffic-head">
          <TrafficQuotaLabel remainingLabel={traffic.remainingLabel} reset={reset} />
          {uptimeLabel ? (
            <span className="compact-node-traffic-uptime">{uptimeLabel}</span>
          ) : (
            <span className="traffic-quota-usage">{traffic.detail}</span>
          )}
        </div>
        <div className="compact-node-gauge-track" aria-hidden />
        {uptimeLabel && <span className="compact-node-traffic-value">{traffic.detail}</span>}
      </div>
    </div>
  );
}

// memo:每个 prop 都源自 ping,在父卡片每 ~1s 指标 tick 重渲染时引用稳定(ping 数据
// ~60s 才刷新一次),所以在 ping 数据真正变化前,跳过重渲染 latency/loss HealthBars
// 这棵子树 —— 它是每 tick DOM 开销的大头。
const CompactNodeHealth = memo(function CompactNodeHealth({
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
  // 已绑定但无样本时显示"无样本",未绑定时显示"未配置" —— 见 pingEmptyLabels。
  const { text: emptyText } = pingEmptyLabels(
    hasRealHomepagePingBinding,
    pingLoading,
    pingError,
  );
  const latencyLabel = ping.taskName?.trim() || "延迟";
  return (
    <div
      className="compact-node-bottom"
      data-ping-state={ping.loadState ?? "ready"}
      title={
        pingError && (ping.lastValue != null || ping.loss != null)
          ? "首页 Ping 刷新失败，显示上次数据"
          : undefined
      }
    >
      <CompactHealthItem
        icon={<Clock3 size={12} />}
        label={latencyLabel}
        value={ping.lastValue != null ? Math.round(ping.lastValue).toString() : emptyText}
        unit={ping.lastValue != null ? "ms" : undefined}
        color={latencyColor}
      >
        <HealthBars buckets={pingBuckets} kind="latency" />
      </CompactHealthItem>
      <CompactHealthItem
        icon={<Unplug size={12} />}
        label="丢包"
        value={ping.loss != null ? ping.loss.toFixed(1) : emptyText}
        unit={ping.loss != null ? "%" : undefined}
        color={lossColor}
      >
        <HealthBars buckets={pingBuckets} kind="loss" />
      </CompactHealthItem>
    </div>
  );
});

export const CompactNodeCard = memo(function CompactNodeCard({
  uuid,
  showCosts = true,
}: {
  uuid: string;
  showCosts?: boolean;
}) {
  const model = useNodeCardModel(uuid, {
    pingBucketCount: HEALTH_BAR_COUNT,
  });
  const themeSettings = useThemeSettings();

  if (!model.node) {
    return <div className="compact-node-card animate-pulse" aria-busy />;
  }

  const {
    node,
    traffic,
    trafficReset,
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
    loadFraction,
    hasRealHomepagePingBinding,
    pingLoading,
    pingError,
    osName,
  } = model;
  const showTrafficTotal = themeSettings.isReady && themeSettings.compactShowTrafficTotal;
  const showBilling = themeSettings.isReady && themeSettings.compactShowBilling;
  const showUptime = themeSettings.isReady && themeSettings.compactShowUptime;
  // 开关关闭或节点离线时,完全跳过格式化工作。
  const uptimeLabel = showUptime && !isOffline ? formatCompactUptime(node.uptime) : "";

  return (
    <article className={clsx("compact-node-card", isOffline && "is-offline")}>
      <CompactNodeHeader
        node={node}
        osName={osName}
      />
      <CompactNodeChips subtitle={subtitle} tags={footerTags} ipv4={node.ipv4} ipv6={node.ipv6} />
      <CompactNodeVitals node={node} loadFraction={loadFraction} />
      <CompactNodeInfoStrip
        node={node}
        trafficTrend={trafficTrend}
        upRate={upRate}
        downRate={downRate}
        showTrafficTotal={showTrafficTotal}
        showBilling={showBilling}
        showCosts={showCosts}
        expire={expire}
        expireColor={expireColor}
        renewalPrice={renewalPrice}
      />
      <CompactTrafficBar traffic={traffic} uptimeLabel={uptimeLabel} reset={trafficReset} />
      <CompactNodeHealth
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
