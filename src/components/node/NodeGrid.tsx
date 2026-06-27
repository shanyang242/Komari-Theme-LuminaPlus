import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CircleDollarSign } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useAllNodeMeta, useHomeNodeSummaries } from "@/hooks/useNode";
import { useHomepagePingOverview } from "@/hooks/usePingMini";
import { useThemeSettings } from "@/hooks/useThemeSettings";
import { useViewMode } from "@/hooks/useViewMode";
import {
  formatBytes,
  formatByteRate,
  formatByteRateLabel,
} from "@/utils/format";
import { calculateCostSummary, formatCnyMoney, getExchangeRates } from "@/utils/cost";
import { collectMatchingNodeUuids } from "@/utils/nodeIdentity";
import { speedRateColor } from "@/utils/metricTone";
import {
  getHomeGroupLabel,
  getHomeGroupOptions,
  HOME_ALL_GROUP,
  sortHomeGroupOptions,
} from "@/utils/homeNodes";
import { useHomeSort } from "@/hooks/useHomeSort";
import { useHomeNodeOrder } from "@/hooks/useHomeNodeOrder";
import { HomeSortControl } from "./HomeSortControl";
import {
  getOverviewRating,
  type OverviewRating,
  type OverviewRatingStyle,
} from "@/utils/overviewRating";
import { Spinner } from "@/components/ui/Spinner";
import { CompactNodeCard } from "./CompactNodeCard";
import { CostSummary } from "./CostSummary";
import { NodeCard } from "./NodeCard";

// 把多个 uuid 拼成单个签名串作为 memo key。逗号安全:uuid 是标准 UUID
// ([0-9a-f-]),永远不含逗号。
const UUID_KEY_SEPARATOR = ",";

interface HomeOverview {
  totalNodes: number;
  onlineNodes: number;
  offlineNodes: number;
  trafficUp: number;
  trafficDown: number;
  netUp: number;
  netDown: number;
}

function formatCompactBytes(value: number): string {
  const [amount, unit = "B"] = formatBytes(value).split(" ");
  return `${amount}${unit[0]}`;
}

function HomeOverviewCards({
  overview,
  costSummary,
  costLoading,
  showOverviewRatings,
  overviewRatingStyle,
  showTrafficRating,
  showBandwidthRating,
  showAssetRating,
  trafficRatingLabels,
  bandwidthRatingLabels,
  assetRatingLabels,
  showDetailButton,
  onOpenCostSummary,
}: {
  overview: HomeOverview;
  costSummary: { remainingCny: number } | null;
  costLoading: boolean;
  showOverviewRatings: boolean;
  overviewRatingStyle: OverviewRatingStyle;
  showTrafficRating: boolean;
  showBandwidthRating: boolean;
  showAssetRating: boolean;
  trafficRatingLabels: string;
  bandwidthRatingLabels: string;
  assetRatingLabels: string;
  showDetailButton: boolean;
  onOpenCostSummary: () => void;
}) {
  const [trafficValue, trafficUnit] = formatBytes(
    overview.trafficUp + overview.trafficDown,
  ).split(" ");
  const rate = formatByteRate(overview.netUp + overview.netDown);
  const onlinePct =
    overview.totalNodes > 0 ? (overview.onlineNodes / overview.totalNodes) * 100 : 0;
  const offlinePct =
    overview.totalNodes > 0 ? (overview.offlineNodes / overview.totalNodes) * 100 : 0;
  const remainingValue = costSummary
    ? formatCnyMoney(costSummary.remainingCny)
    : costLoading
      ? "计算中"
      : "—";
  const trafficDetailLabel = `↑ ${formatBytes(overview.trafficUp)} · ↓ ${formatBytes(overview.trafficDown)}`;
  const trafficCompactLabel = `↑${formatCompactBytes(overview.trafficUp)} ↓${formatCompactBytes(overview.trafficDown)}`;
  const bandwidthDetailLabel = `↑ ${formatByteRateLabel(overview.netUp)} · ↓ ${formatByteRateLabel(overview.netDown)}`;
  const bandwidthCompactLabel = `↑${formatCompactBytes(overview.netUp)} ↓${formatCompactBytes(overview.netDown)}`;
  const trafficRating =
    showOverviewRatings && showTrafficRating
      ? getOverviewRating({
          kind: "traffic",
          value: overview.trafficUp + overview.trafficDown,
          style: overviewRatingStyle,
          customLabels: trafficRatingLabels,
        })
      : null;
  const bandwidthRating =
    showOverviewRatings && showBandwidthRating
      ? getOverviewRating({
          kind: "bandwidth",
          value: overview.netUp + overview.netDown,
          style: overviewRatingStyle,
          customLabels: bandwidthRatingLabels,
        })
      : null;
  const assetRating =
    showOverviewRatings && showAssetRating && costSummary
      ? getOverviewRating({
          kind: "asset",
          value: costSummary.remainingCny,
          style: overviewRatingStyle,
          customLabels: assetRatingLabels,
        })
      : null;

  const renderRating = (rating: OverviewRating | null) =>
    rating ? (
      <span className="overview-card-rating" data-rating-level={rating.level} title={rating.label}>
        {rating.label}
      </span>
    ) : null;

  return (
    <section className="home-overview" aria-label="首页总览">
      <article className="overview-card">
        <span className="overview-card-label">在线节点</span>
        <div className="overview-card-main">
          <p className="overview-card-value">
            {overview.onlineNodes}
            <span className="overview-card-unit">/ {overview.totalNodes}</span>
          </p>
        </div>
        {overview.totalNodes >= 5 && overview.totalNodes <= 10 ? (
          // 节点数 5–10 时改用块状:每台一格,在线格在左、离线格在右、未知格居中,
          // 与条状的「左绿右红」完全同步。颜色复用同一组 token,避免该红却绿。
          <div className="overview-blocks" role="presentation">
            {Array.from({ length: overview.totalNodes }, (_, i) => {
              const cls =
                i < overview.onlineNodes
                  ? "overview-block is-online"
                  : i >= overview.totalNodes - overview.offlineNodes
                    ? "overview-block is-offline"
                    : "overview-block";
              return <span key={i} className={cls} />;
            })}
          </div>
        ) : (
          <div className="overview-bar" role="presentation">
            <span className="overview-bar-online" style={{ width: `${onlinePct}%` }} />
            <span className="overview-bar-offline" style={{ width: `${offlinePct}%` }} />
          </div>
        )}
      </article>

      <article className="overview-card">
        <span className="overview-card-label">累计流量</span>
        <div className="overview-card-main">
          <p className="overview-card-value">
            {trafficValue}
            <span className="overview-card-unit">{trafficUnit}</span>
          </p>
        </div>
        <div className="overview-card-footer">
          <p className="overview-card-sub" title={trafficDetailLabel}>
            <span className="overview-card-sub-full">{trafficDetailLabel}</span>
            <span className="overview-card-sub-compact">{trafficCompactLabel}</span>
          </p>
          {renderRating(trafficRating)}
        </div>
      </article>

      <article className="overview-card">
        <span className="overview-card-label">实时带宽</span>
        <div className="overview-card-main">
          <p className="overview-card-value" style={{ color: speedRateColor(rate.unit) }}>
            {rate.value}
            <span className="overview-card-unit">{rate.unit}</span>
          </p>
        </div>
        <div className="overview-card-footer">
          <p className="overview-card-sub" title={bandwidthDetailLabel}>
            <span className="overview-card-sub-full">{bandwidthDetailLabel}</span>
            <span className="overview-card-sub-compact">{bandwidthCompactLabel}</span>
          </p>
          {renderRating(bandwidthRating)}
        </div>
      </article>

      <article className="overview-card">
        <div className="overview-card-head">
          <span className="overview-card-label">资产概览</span>
          {showDetailButton && (
            <button
              type="button"
              className="overview-card-action"
              onClick={onOpenCostSummary}
              aria-label="打开资产统计详情"
              title="资产统计"
            >
              <CircleDollarSign size={15} />
            </button>
          )}
        </div>
        <div className="overview-card-main">
          <p className="overview-card-value">{remainingValue}</p>
        </div>
        <div className="overview-card-footer">
          <p className="overview-card-caption">实时汇率计算</p>
          {renderRating(assetRating)}
        </div>
      </article>
    </section>
  );
}

function GroupTabs({
  groups,
  selectedGroup,
  onSelectGroup,
}: {
  groups: string[];
  selectedGroup: string;
  onSelectGroup: (group: string) => void;
}) {
  return (
    <div className="home-group-tabs" role="tablist" aria-label="节点分组">
      <button
        type="button"
        role="tab"
        aria-selected={selectedGroup === HOME_ALL_GROUP}
        data-active={selectedGroup === HOME_ALL_GROUP ? "true" : "false"}
        onClick={() => onSelectGroup(HOME_ALL_GROUP)}
      >
        全部
      </button>
      {groups.map((group) => (
        <button
          key={group}
          type="button"
          role="tab"
          aria-selected={selectedGroup === group}
          data-active={selectedGroup === group ? "true" : "false"}
          onClick={() => onSelectGroup(group)}
          title={group}
        >
          {group}
        </button>
      ))}
    </div>
  );
}

export function NodeGrid() {
  const nodes = useHomeNodeSummaries();
  const allMeta = useAllNodeMeta();
  const { data: me } = useAuth();
  const themeSettings = useThemeSettings();
  const { mode } = useViewMode();
  const sort = useHomeSort();
  // enableHomeSort 控制访客能否改排序;关闭时无视 session 覆盖、直接用管理员默认序(默认仍是 weight)。
  const sortEnabled = themeSettings.isReady && themeSettings.enableHomeSort;
  const sortField = sortEnabled ? sort.field : themeSettings.homeSortField;
  const sortDirection = sortEnabled ? sort.direction : themeSettings.homeSortDirection;
  const [selectedGroup, setSelectedGroup] = useState(HOME_ALL_GROUP);
  const [costSummaryOpen, setCostSummaryOpen] = useState(false);
  useHomepagePingOverview();

  // 主题级「隐藏节点」:按名称/UUID 命中的节点彻底移除。名称匹配需要完整 meta(摘要无 name),
  // 所以在 allMeta 上算出 uuid 集合,再同时应用到卡片摘要(显示/总览/分组)与费用 meta。
  // 整个 NodeGrid 在 themeSettings.isReady 之前只渲染 Spinner(见下方早退),而隐藏列表就在
  // 同一 config 里,所以节点首次渲染时隐藏已生效——不会先显示再消失地闪烁。
  const hiddenUuids = useMemo(
    () => collectMatchingNodeUuids(allMeta, themeSettings.hiddenNodes),
    [allMeta, themeSettings.hiddenNodes],
  );
  const visibleNodes = useMemo(
    () =>
      nodes.filter(
        (node) => (me?.logged_in === true || !node.hidden) && !hiddenUuids.has(node.uuid),
      ),
    [me?.logged_in, nodes, hiddenUuids],
  );
  // 与卡片摘要(visibleNodes)同一可见性口径:后台 hidden 仅登录管理员可见、访客一律剔除,
  // 主题级隐藏对所有人剔除。资产统计(数量/总额/明细)走这份 meta,否则访客虽看不到隐藏卡片,
  // 却仍能从资产概览/明细里读到隐藏节点的名称、价格、到期。
  const visibleMeta = useMemo(
    () =>
      allMeta.filter(
        (node) => (me?.logged_in === true || !node.hidden) && !hiddenUuids.has(node.uuid),
      ),
    [allMeta, me?.logged_in, hiddenUuids],
  );
  // 「名称」排序需要展示名(摘要无 name),从 meta 注入。
  const nameByUuid = useMemo(() => {
    const map = new Map<string, string>();
    for (const node of visibleMeta) map.set(node.uuid, node.name?.trim() || node.uuid);
    return map;
  }, [visibleMeta]);
  const overview = useMemo<HomeOverview>(() => {
    let onlineNodes = 0;
    let offlineNodes = 0;
    let trafficUp = 0;
    let trafficDown = 0;
    let netUp = 0;
    let netDown = 0;
    for (const node of visibleNodes) {
      if (node.online === true) onlineNodes += 1;
      else if (node.online === false) offlineNodes += 1;
      trafficUp += node.trafficUp;
      trafficDown += node.trafficDown;
      netUp += node.netUp;
      netDown += node.netDown;
    }

    return {
      totalNodes: visibleNodes.length,
      onlineNodes,
      offlineNodes,
      trafficUp,
      trafficDown,
      netUp,
      netDown,
    };
  }, [visibleNodes]);
  const showHomeOverview = themeSettings.isReady && themeSettings.showHomeOverview;
  const hasNodes = visibleMeta.length > 0;
  // 资产概览卡片(剩余价值)始终显示,这样切换花费相关设置不会让整行重排。
  // showCostSummary 控制卡片右上角的详情按钮;悬浮球是兜底入口,只在详情按钮
  // 不显示时出现(总览隐藏或其开关关闭),所以两个入口不会同时出现(都开时卡内
  // 详情按钮优先)。
  const showAssetCard = showHomeOverview && hasNodes;
  const showCostDetailButton =
    showAssetCard && themeSettings.isReady && themeSettings.showCostSummary;
  const showCostFloatingButton =
    themeSettings.isReady &&
    themeSettings.showCostSummaryFloatingButton &&
    hasNodes &&
    !showCostDetailButton;
  // 只要有东西用到花费就计算:常驻的资产卡片,或悬浮球/面板。面板只在能被打开时才挂载。
  const costNeeded = showAssetCard || showCostFloatingButton;
  const shouldRenderCostSummary = showCostDetailButton || showCostFloatingButton;
  const rateQuery = useQuery({
    queryKey: ["cost-rates", themeSettings.costRateApiUrl],
    queryFn: () => getExchangeRates(themeSettings.costRateApiUrl),
    staleTime: 60 * 60 * 1000,
    // 「价格」排序也要汇率换算月化价,即便没显示资产卡也得拉一次;但空列表无需拉。
    enabled: (costNeeded || sortField === "price") && hasNodes,
    retry: 1,
  });
  const costSummary = useMemo(
    () =>
      rateQuery.data
        ? calculateCostSummary(visibleMeta, themeSettings.costIgnoredNodes, rateQuery.data.rates)
        : null,
    [visibleMeta, themeSettings.costIgnoredNodes, rateQuery.data],
  );
  // 「价格」排序键:月化价格(CNY);免费/忽略/汇率缺失的节点 null,排到默认序之后。
  const priceByUuid = useMemo(() => {
    const map = new Map<string, number | null>();
    if (costSummary) {
      for (const detail of costSummary.details) {
        map.set(detail.uuid, detail.counted ? detail.monthlyCny : null);
      }
    }
    return map;
  }, [costSummary]);
  const costLoading = costNeeded && rateQuery.isLoading;
  useEffect(() => {
    if (!shouldRenderCostSummary && costSummaryOpen) setCostSummaryOpen(false);
  }, [shouldRenderCostSummary, costSummaryOpen]);
  const groupOptions = useMemo(
    () =>
      sortHomeGroupOptions(
        getHomeGroupOptions(visibleNodes),
        themeSettings.isReady ? themeSettings.homeGroupOrder : [],
      ),
    [visibleNodes, themeSettings.homeGroupOrder, themeSettings.isReady],
  );
  const filteredNodes = useMemo(
    () =>
      selectedGroup === HOME_ALL_GROUP
        ? visibleNodes
        : visibleNodes.filter((node) => getHomeGroupLabel(node.group) === selectedGroup),
    [visibleNodes, selectedGroup],
  );
  // 排序在分组筛选之后。离线永远沉底(写死,见 homeSort);实时网速走防抖(键平滑+滞回+5s 重排)。
  const orderedNodes = useHomeNodeOrder({
    nodes: filteredNodes,
    field: sortField,
    direction: sortDirection,
    nameByUuid,
    priceByUuid,
  });

  useEffect(() => {
    if (selectedGroup !== HOME_ALL_GROUP && !groupOptions.includes(selectedGroup)) {
      setSelectedGroup(HOME_ALL_GROUP);
    }
  }, [groupOptions, selectedGroup]);

  // summary 对象每隔约 1s tick 就换新引用,导致 filteredNodes(以及直接映射 uuid)
  // 不停重建。改用稳定的 uuid 签名作为卡片列表的 key,这样只有集合或顺序真正变化时
  // 才重渲染——每张卡各自订阅自己的 store 切片、独立更新。
  const uuidsKey = useMemo(
    () => orderedNodes.map((node) => node.uuid).join(UUID_KEY_SEPARATOR),
    [orderedNodes],
  );
  const cards = useMemo(() => {
    const uuids = uuidsKey ? uuidsKey.split(UUID_KEY_SEPARATOR) : [];
    return uuids.map((uuid) => (
      <div key={uuid} className="min-w-0">
        {mode === "compact" ? <CompactNodeCard uuid={uuid} /> : <NodeCard uuid={uuid} />}
      </div>
    ));
  }, [uuidsKey, mode]);
  const showGroupTabs =
    themeSettings.isReady && themeSettings.showGroupTabs && groupOptions.length > 0;
  // 节点多于一个才有排序意义;空/单节点时不显示控件。
  const showHomeSort = sortEnabled && visibleNodes.length > 1;
  // 分组标签栏和卡片网格共用,让标签栏处在同一网格中、正好占一列卡片宽——
  // 边缘和第一张卡片对齐。
  const gridClassName = mode === "compact" ? "grid gap-3 xl:gap-4" : "grid gap-4 xl:gap-5";
  const gridColumns =
    mode === "compact"
      ? "repeat(auto-fill, minmax(min(100%, 340px), 1fr))"
      : "repeat(auto-fill, minmax(min(100%, 360px), 1fr))";

  if (!themeSettings.isReady) {
    return (
      <div className="flex h-[40vh] items-center justify-center">
        <Spinner size={24} />
      </div>
    );
  }

  // 成本浮窗 + 首页概览卡在「空节点」与正常两个分支里完全一致，提取一次复用。
  const homeHeader = (
    <>
      {shouldRenderCostSummary && (
        <CostSummary
          open={costSummaryOpen}
          onOpenChange={setCostSummaryOpen}
          showLauncher={showCostFloatingButton}
        />
      )}
      {showHomeOverview && (
        <HomeOverviewCards
          overview={overview}
          showDetailButton={showCostDetailButton}
          costSummary={costSummary}
          costLoading={costLoading}
          showOverviewRatings={themeSettings.showOverviewRatings}
          overviewRatingStyle={themeSettings.overviewRatingStyle}
          showTrafficRating={themeSettings.showTrafficRating}
          showBandwidthRating={themeSettings.showBandwidthRating}
          showAssetRating={themeSettings.showAssetRating}
          trafficRatingLabels={themeSettings.trafficRatingLabels}
          bandwidthRatingLabels={themeSettings.bandwidthRatingLabels}
          assetRatingLabels={themeSettings.assetRatingLabels}
          onOpenCostSummary={() => setCostSummaryOpen(true)}
        />
      )}
    </>
  );

  if (visibleNodes.length === 0) {
    return (
      <>
        {homeHeader}
        <div className="flex h-[40vh] flex-col items-center justify-center gap-2 text-[var(--text-tertiary)]">
          <span className="text-[15px]">尚未连接到任何节点</span>
          <span className="text-[12px]">等待后端推送或前往管理后台添加</span>
        </div>
      </>
    );
  }

  return (
    <>
      {homeHeader}
      {(showGroupTabs || showHomeSort) && (
        // 复用卡片网格的列定义:分组标签落第一列(=一张卡宽,随响应式动态变化、左缘对齐首卡,
        // 沿用旧行为);排序控件钉最后一列右对齐。窄屏只剩 1 列时排序自动落到下一行右对齐。
        <div
          className={`${gridClassName} home-controls-bar mb-4`}
          style={{ gridTemplateColumns: gridColumns }}
        >
          {showGroupTabs && (
            <GroupTabs
              groups={groupOptions}
              selectedGroup={selectedGroup}
              onSelectGroup={setSelectedGroup}
            />
          )}
          {showHomeSort && <HomeSortControl state={sort} />}
        </div>
      )}
      <div className={gridClassName} style={{ gridTemplateColumns: gridColumns }}>
        {cards}
      </div>
    </>
  );
}
