import { memo, useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";
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
import { useMetricColorsVersion } from "@/hooks/useMetricColors";
import { formatBytes } from "@/utils/format";
import { HOMEPAGE_MULTI_PING_TASK_COUNT } from "@/utils/pingTasks";
import {
  speedRateColor,
  trafficQuotaSegmentColor,
} from "@/utils/metricTone";
import { Flag } from "@/components/ui/Flag";
import { OsLogo } from "@/components/ui/OsLogo";
import { MetricBar } from "./MetricBar";
import { LatencyBars } from "./LatencyBars";
import { QualityBars } from "./QualityBars";
import { CanvasStrip, mixSrgbTowardWhite, safeCanvasColor } from "./CanvasStrip";
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
import { MultiPingStatus } from "./MultiPingStatus";
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
  // 自定义配色改动时 version 自增，拼进 redrawKey 让 canvas 进度条即时重画（含离线静态卡）。
  const colorsVersion = useMetricColorsVersion();
  const redrawKey = `${resolvedAppearance}:${colorsVersion}`;
  const model = useNodeCardModel(uuid, { includeMultiPing: true });

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
    homepagePingLines,
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

          {homepagePingLines.length === HOMEPAGE_MULTI_PING_TASK_COUNT ? (
            <MultiPingStatus
              lines={homepagePingLines}
              density="large"
              className="card-metric-section"
            />
          ) : (
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
          )}
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

// 每段的位置色是纯常量(trafficQuotaSegmentColor 只依赖位置、与主题无关),预计算一次,避免每
// ~1s metrics tick 为每个点亮段重跑 OKLCH 插值 + 字符串构造。
const TRAFFIC_QUOTA_SEGMENT_COLORS = Array.from(
  { length: TRAFFIC_QUOTA_SEGMENTS },
  (_, i) => trafficQuotaSegmentColor((i + 0.5) / TRAFFIC_QUOTA_SEGMENTS),
);

// 点亮段数:段 i 亮 ⇔ (i+0.5)/N <= fraction。抽成整数后传给 memo 化的 NodeTrafficQuota ——
// fraction 每 tick 微动,但 litCount 只在跨越 1/N 边界时才变,于是稳态下整棵配额条子树能跳过重渲染。
//
// 用量非零但连半段(0.5/18≈2.8%)都点不亮时,返回哨兵值 -1,而不是直接借用 1(点亮整段)——
// 借整段会把 0.01% 的用量夸张成 2.8%。NodeTrafficQuota 看到 -1 会把第 0 段画成"段内一道细边"
// (TRAFFIC_SLIVER_RATIO,与小卡共用同一比例语义),既提示"用过一点"又不失真。这仍是一个离散
// 哨兵值而非连续量,不会破坏上面说的"稳态跳过重渲染"。
function trafficQuotaLitCount(fraction: number) {
  let count = 0;
  for (let i = 0; i < TRAFFIC_QUOTA_SEGMENTS; i++) {
    if ((i + 0.5) / TRAFFIC_QUOTA_SEGMENTS <= fraction) count += 1;
    else break;
  }
  if (count === 0 && fraction > 0) return -1;
  return count;
}

// 流量阈值行:label + 剩余量(剩余量用中性色,不抢眼)、同行的 used / limit(弱化),
// 下面是 18 个独立 segment。每个 segment 按它的绝对位置上色(绿→黄→红,见 trafficQuotaSegmentColor
// / 上面预算好的色数组),只要 used fraction 到达就点亮,否则用中性轨道色 —— 于是点亮区段呈现整条
// 渐变,前沿就能看出离用满还有多远。memo + litCount:父卡片每 tick 重渲染,但只要点亮段数与文案没变
// 就整棵跳过。
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
          // litCount === -1:哨兵值,第 0 段画成段内一道细边(细边宽度 = TRAFFIC_SLIVER_RATIO),
          // 而不是点亮/熄灭一整段。见 trafficQuotaLitCount 顶部注释。
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

// memo:父卡片每 ~1s 指标 tick 重渲染时,这里每个 prop 都是引用稳定的 —— ping 数据
// ~60s 才刷新一次 —— 所以 latency/loss 柱子这棵子树能跳过每个 tick 的工作。
// hover 状态收在本段内(两图互斥),悬停时不再重渲整张卡。
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

  return (
    <div className="card-metric-section server-health-grid">
      <div className="server-health-block">
        <div className="server-health-head">
          <div className="server-health-label">
            <Clock3 size={13} strokeWidth={2} />
            <span>延迟</span>
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
            <LatencyBars
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
            <QualityBars
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

// 可见 footer 行和屏外测量行共用,免得改样式时两边走样。本身不带 title:可见行的
// title 已经挂了完整 tag 列表,chip 不带 title 时 hover 会穿透到那一行,于是 hover
// 任意 chip 都能看到全部 tag(包括 fit 阶段被丢掉的),而不只是这个 chip 的 label。
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
  const rowRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [visibleTagCount, setVisibleTagCount] = useState(footerTags.length);
  const visibleTags = footerTags.slice(0, visibleTagCount);
  // 完整 tag 列表挂在这一行的 tooltip 上;chip 不带自己的 title,hover 会穿透到行上 ——
  // fit 阶段丢掉的 tag 就靠这个保持可见,不用显示"+N"角标。
  const tagTitle = joinTagTitle(footerTags);

  useLayoutEffect(() => {
    const row = rowRef.current;
    const measure = measureRef.current;
    if (!row || !measure) return;

    // chip 间距是个固定的 CSS token,每次 effect 跑读一次就够,不必每个 resize tick 都读。
    const styles = window.getComputedStyle(measure);
    const gap = Number.parseFloat(styles.columnGap || styles.gap || "0") || 0;

    const updateVisibleTags = () => {
      const availableWidth = row.clientWidth;
      const children = Array.from(measure.children) as HTMLElement[];
      const tagWidths = children.slice(0, footerTags.length).map((child) => child.offsetWidth);
      const priceWidth = renewalPrice ? (children[footerTags.length]?.offsetWidth ?? 0) : 0;

      let usedWidth = renewalPrice ? priceWidth : 0;
      let nextVisibleCount = 0;

      for (const width of tagWidths) {
        const nextWidth = usedWidth + (usedWidth > 0 ? gap : 0) + width;
        if (nextWidth > availableWidth) break;
        usedWidth = nextWidth;
        nextVisibleCount += 1;
      }

      // 绝不塌成空行:就算第一个 tag 比价格 chip 之后剩的空间还宽,也照样显示,交给 CSS 省略号截断。
      if (nextVisibleCount === 0 && tagWidths.length > 0) nextVisibleCount = 1;

      setVisibleTagCount((current) =>
        current === nextVisibleCount ? current : nextVisibleCount,
      );
    };

    updateVisibleTags();

    let cancelled = false;
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateVisibleTags);
    if (observer) {
      observer.observe(row);
    } else {
      window.addEventListener("resize", updateVisibleTags);
    }
    // 字体替换会在首次绘制后改变 tag 宽度;字体就绪后重新测量一次,
    // 但若卡片在 promise resolve 前已卸载则跳过。
    document.fonts?.ready.then(() => {
      if (!cancelled) updateVisibleTags();
    });

    return () => {
      cancelled = true;
      observer?.disconnect();
      if (!observer) window.removeEventListener("resize", updateVisibleTags);
    };
  }, [footerTags, renewalPrice]);

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
        <>
          <div className="dstatus-tags-row" ref={rowRef} title={footerTags.length > 0 ? tagTitle : undefined}>
            {visibleTags.map((tag, index) => (
              <FooterTagChip key={`${tag.label}-${index}`} tag={tag} />
            ))}
            {renewalPrice && <FooterPriceChip renewalPrice={renewalPrice} titled />}
          </div>
          <div className="dstatus-tags-row dstatus-tags-measure" ref={measureRef} aria-hidden>
            {footerTags.map((tag, index) => (
              <FooterTagChip key={`${tag.label}-${index}`} tag={tag} />
            ))}
            {renewalPrice && <FooterPriceChip renewalPrice={renewalPrice} />}
          </div>
        </>
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
  // 按当前速率单位档取热力色:文字/圆点/实时点都随速度量级变色,图标仍用方向色(color)区分上下行。
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
  // 除非 traffic samples(缓存的 store 快照)或 color 变了,否则保持稳定,
  // 这样 canvas 只在趋势真的变动时才重绘。
  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, width: number, height: number) => {
      if (samples.length === 0) return;
      const slotWidth = width / samples.length;
      // 一次性归一化:safeCanvasColor 解析 var() 并把 hsl() 转成 rgb(),所以
      // baseColor/inactiveColor 对 canvas 安全,mixSrgbTowardWhite 的 hex 输出也是 ——
      // 下面循环里不需要再逐点归一化颜色。
      const baseColor = safeCanvasColor(color);
      const inactiveColor = safeCanvasColor("var(--progress-bg)");

      samples.forEach((sample, index) => {
        const hasTraffic = sample.value > 0;
        const scale = hasTraffic ? 0.72 + sample.level * 0.82 : 0.46;
        const radius = 2 * scale;
        // 用 JS 做 sRGB 混色(不用 canvas 的 color-mix() 字符串,老 WebKit 不认)。
        const tone = hasTraffic
          ? mixSrgbTowardWhite(baseColor, (68 + sample.level * 20) / 100)
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
