import {
  lazy,
  memo,
  Suspense,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { Flag } from "@/components/ui/Flag";
import { ErrorBoundary } from "@/components/shell/ErrorBoundary";
import { useAuth } from "@/hooks/useAuth";
import {
  useHomeNodeSummaries,
  useNodeOnlineSummaries,
  useNodeStoreStatus,
} from "@/hooks/useNode";
import { useHomepagePingOverview } from "@/hooks/usePingOverview";
import { usePublicConfig } from "@/hooks/usePublicConfig";
import { useThemeSettings } from "@/hooks/useThemeSettings";
import { useViewMode } from "@/hooks/useViewMode";
import {
  formatBytes,
  formatByteRate,
  formatByteRateLabel,
} from "@/utils/format";
import {
  calculateCostSummary,
  formatCnyMoney,
  formatSignedCny,
  getExchangeRates,
} from "@/utils/cost";
import { useVisibleNodes } from "@/hooks/useVisibleNodes";
import { speedRateColor } from "@/utils/metricTone";
import {
  getHomeGroupLabel,
  getHomeGroupOptions,
  getHomeRegionOptions,
  moveOfflineHomeNodesLast,
  HOME_ALL_GROUP,
  HOME_ALL_REGION,
  type HomeRegionOption,
} from "@/utils/homeNodes";
import { getDisplayRegionCode } from "@/utils/geo";
import { useHourlyClock } from "@/hooks/useClock";
import { preloadAssetsPage } from "@/services/assetsPageLoader";
import { CompactNodeCard } from "./CompactNodeCard";
import { NodeCard } from "./NodeCard";
import { RenewalReminder } from "./RenewalReminder";
import { canViewCosts, type NodeViewMode } from "@/utils/themeSettings";
import type { RenewalReminderSource } from "@/utils/renewalReminder";

const NodeMapBackground = lazy(() =>
  import("./NodeMapBackground").then((module) => ({ default: module.NodeMapBackground })),
);

const GRID_LAYOUT: Record<NodeViewMode, { className: string; minColumnWidth: number }> = {
  large: { className: "grid gap-4 xl:gap-5", minColumnWidth: 360 },
  compact: { className: "grid gap-3 xl:gap-4", minColumnWidth: 340 },
};

const UUID_KEY_SEPARATOR = ",";

type IdleCapableWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

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

function HomeBrand({ siteName }: { siteName: string }) {
  return (
    <header className="home-brand" aria-label="站点名称">
      <h1 className="home-brand-title" title={siteName}>
        {siteName}
      </h1>
    </header>
  );
}

function HomeOverviewCards({
  visibleUuidSet,
  mapBackground,
  costSummary,
  costLoading,
  showCosts,
  showDetailButton,
  renewalNodes,
}: {
  visibleUuidSet: ReadonlySet<string>;
  mapBackground: boolean;
  costSummary: { remainingCny: number; premiumTotalCny: number } | null;
  costLoading: boolean;
  showCosts: boolean;
  showDetailButton: boolean;
  renewalNodes: RenewalReminderSource[];
}) {
  // 高频网速/流量订阅收敛于此，避免触发外层网格重算
  const summaries = useHomeNodeSummaries();
  const overview = useMemo<HomeOverview>(() => {
    let totalNodes = 0;
    let onlineNodes = 0;
    let offlineNodes = 0;
    let trafficUp = 0;
    let trafficDown = 0;
    let netUp = 0;
    let netDown = 0;
    for (const node of summaries) {
      if (!visibleUuidSet.has(node.uuid)) continue;
      totalNodes += 1;
      if (node.online === true) onlineNodes += 1;
      else if (node.online === false) offlineNodes += 1;
      trafficUp += node.trafficUp;
      trafficDown += node.trafficDown;
      netUp += node.netUp;
      netDown += node.netDown;
    }

    return {
      totalNodes,
      onlineNodes,
      offlineNodes,
      trafficUp,
      trafficDown,
      netUp,
      netDown,
    };
  }, [summaries, visibleUuidSet]);
  const [trafficValue, trafficUnit] = formatBytes(
    overview.trafficUp + overview.trafficDown,
  ).split(" ");
  const rate = formatByteRate(overview.netUp + overview.netDown);
  const onlinePct =
    overview.totalNodes > 0 ? (overview.onlineNodes / overview.totalNodes) * 100 : 0;
  const offlinePct =
    overview.totalNodes > 0 ? (overview.offlineNodes / overview.totalNodes) * 100 : 0;
  const remainingValue = !showCosts
    ? "-"
    : costSummary
      ? formatCnyMoney(costSummary.remainingCny)
      : costLoading
        ? "计算中"
        : "—";
  const premiumValue = showCosts && costSummary
    ? formatSignedCny(costSummary.premiumTotalCny)
    : null;
  const premiumTone = costSummary
    ? costSummary.premiumTotalCny > 0
      ? "positive"
      : costSummary.premiumTotalCny < 0
        ? "negative"
        : "neutral"
    : undefined;
  const trafficDetailLabel = `↑ ${formatBytes(overview.trafficUp)} · ↓ ${formatBytes(overview.trafficDown)}`;
  const trafficCompactLabel = `↑${formatCompactBytes(overview.trafficUp)} ↓${formatCompactBytes(overview.trafficDown)}`;
  const bandwidthDetailLabel = `↑ ${formatByteRateLabel(overview.netUp)} · ↓ ${formatByteRateLabel(overview.netDown)}`;
  const bandwidthCompactLabel = `↑${formatCompactBytes(overview.netUp)} ↓${formatCompactBytes(overview.netDown)}`;
  return (
    <section
      className={mapBackground ? "home-overview is-map" : "home-overview"}
      aria-label="首页总览"
    >
      <article className="overview-card" data-metric="online">
        <span className="overview-card-label">在线节点</span>
        <div className="overview-card-main">
          <p className="overview-card-value">
            {overview.onlineNodes}
            <span className="overview-card-unit">/ {overview.totalNodes}</span>
          </p>
        </div>
        {overview.totalNodes >= 5 && overview.totalNodes <= 10 ? (
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

      <article className="overview-card" data-metric="bandwidth">
        <span className="overview-card-label">实时带宽</span>
        <div className="overview-card-main">
          <p
            className="overview-card-value"
            style={{ color: speedRateColor(rate.unit) }}
          >
            {rate.value}
            <span className="overview-card-unit">{rate.unit}</span>
          </p>
        </div>
        <div className="overview-card-footer">
          <p className="overview-card-sub" title={bandwidthDetailLabel}>
            <span className="overview-card-sub-full">{bandwidthDetailLabel}</span>
            <span className="overview-card-sub-compact">{bandwidthCompactLabel}</span>
          </p>
        </div>
      </article>

      <article className="overview-card" data-metric="traffic">
        <div className="overview-card-head">
          <span className="overview-card-label">累计流量</span>
        </div>
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
        </div>
      </article>

      <article className="overview-card" data-metric="asset">
        <div className="overview-card-head">
          <span className="overview-card-label">资产概览</span>
          {showDetailButton && <RenewalReminder nodes={renewalNodes} />}
        </div>
        <div className="overview-card-main overview-card-asset-main">
          <p className="overview-card-value">{remainingValue}</p>
          {premiumValue && (
            <span
              className="overview-card-premium"
              data-tone={premiumTone}
              title="全部节点收购溢价合计"
            >
              <strong>{premiumValue}</strong>
            </span>
          )}
        </div>
        <div className="overview-card-footer">
          <p className="overview-card-caption">实时汇率计算</p>
        </div>
      </article>
    </section>
  );
}

const GroupTabs = memo(function GroupTabs({
  groups,
  selectedGroup,
  onSelectGroup,
}: {
  groups: string[];
  selectedGroup: string;
  onSelectGroup: (group: string) => void;
}) {
  return (
    <div className="home-group-tabs" role="group" aria-label="节点分组">
      <button
        type="button"
        aria-pressed={selectedGroup === HOME_ALL_GROUP}
        data-active={selectedGroup === HOME_ALL_GROUP ? "true" : "false"}
        onClick={() => onSelectGroup(HOME_ALL_GROUP)}
      >
        全部
      </button>
      {groups.map((group) => (
        <button
          key={group}
          type="button"
          aria-pressed={selectedGroup === group}
          data-active={selectedGroup === group ? "true" : "false"}
          onClick={() => onSelectGroup(group)}
          title={group}
        >
          {group}
        </button>
      ))}
    </div>
  );
});

const RegionTabs = memo(function RegionTabs({
  regions,
  selectedRegion,
  onSelectRegion,
  mapGridClassName,
  mapGridStyle,
}: {
  regions: HomeRegionOption[];
  selectedRegion: string;
  onSelectRegion: (region: string) => void;
  mapGridClassName?: string;
  mapGridStyle?: CSSProperties;
}) {
  const isMapLayout = Boolean(mapGridClassName && mapGridStyle);
  const bar = (
    <section
      className="home-region-bar"
      data-map-span={isMapLayout ? (regions.length > 5 ? "2" : "1") : undefined}
      aria-label="地区筛选"
    >
      <div className="home-region-chips" role="group">
        {regions.map(({ code, count }) => {
          const active = selectedRegion === code;
          return (
            <button
              key={code}
              type="button"
              className="home-region-chip"
              data-active={active ? "true" : "false"}
              aria-pressed={active}
              onClick={() => onSelectRegion(active ? HOME_ALL_REGION : code)}
              title={code}
            >
              <Flag region={code} size={isMapLayout ? 12 : 14} />
              <span className="home-region-chip-code">{code}</span>
              <span className="home-region-chip-count">{count}</span>
            </button>
          );
        })}
      </div>
    </section>
  );

  if (!isMapLayout) return bar;
  return (
    <div className={`${mapGridClassName} home-map-region-row`} style={mapGridStyle}>
      {bar}
    </div>
  );
});

export function NodeGrid() {
  const now = useHourlyClock();
  const nodeOnlineSummaries = useNodeOnlineSummaries();
  const visibleMeta = useVisibleNodes();
  const { hydrated: storeHydrated, nodeInfoError } = useNodeStoreStatus();
  const { data: me, isError: authError } = useAuth();
  const { data: publicConfig } = usePublicConfig();
  const siteName = publicConfig?.sitename?.trim() || "节点概览";
  const themeSettings = useThemeSettings();
  const { mode, device } = useViewMode();
  const costsVisible =
    canViewCosts(themeSettings, !authError && me?.logged_in === true);
  const [selectedGroup, setSelectedGroup] = useState(HOME_ALL_GROUP);
  const [selectedRegion, setSelectedRegion] = useState(HOME_ALL_REGION);
  const [mapFailed, setMapFailed] = useState(false);
  useHomepagePingOverview();

  const onlineByUuid = useMemo(
    () => new Map(nodeOnlineSummaries.map((node) => [node.uuid, node.online] as const)),
    [nodeOnlineSummaries],
  );
  const visibleUuidSet = useMemo(
    () => new Set(visibleMeta.map((node) => node.uuid)),
    [visibleMeta],
  );
  const visibleNodes = useMemo(
    () =>
      moveOfflineHomeNodesLast(
        visibleMeta.map((node) => ({
          uuid: node.uuid,
          group: String(node.group || "").trim(),
          region: String(node.region || "").trim(),
          online: onlineByUuid.get(node.uuid) ?? null,
        })),
      ),
    [onlineByUuid, visibleMeta],
  );
  const renewalNodes = useMemo<RenewalReminderSource[]>(
    () =>
      visibleMeta.map((node) => ({
        ...node,
        online: onlineByUuid.get(node.uuid) ?? null,
      })),
    [onlineByUuid, visibleMeta],
  );
  const showHomeOverview = themeSettings.isReady && themeSettings.showHomeOverview;
  const hasNodes = visibleMeta.length > 0;
  const costOverviewNeeded = showHomeOverview && costsVisible && hasNodes;
  const showCostDetailButton =
    costOverviewNeeded && themeSettings.isReady && themeSettings.showCostSummary;

  useEffect(() => {
    if (!showCostDetailButton) return;

    const idleWindow = window as IdleCapableWindow;
    if (idleWindow.requestIdleCallback) {
      const handle = idleWindow.requestIdleCallback(preloadAssetsPage, { timeout: 2_000 });
      return () => idleWindow.cancelIdleCallback?.(handle);
    }

    const handle = window.setTimeout(preloadAssetsPage, 1_000);
    return () => window.clearTimeout(handle);
  }, [showCostDetailButton]);

  const rateQuery = useQuery({
    queryKey: ["cost-rates", themeSettings.costRateApiUrl],
    queryFn: ({ signal }) => getExchangeRates(themeSettings.costRateApiUrl, { signal }),
    staleTime: 60 * 60 * 1000,
    enabled: costOverviewNeeded,
    retry: 1,
  });
  const costSummary = useMemo(
    () =>
      costsVisible && rateQuery.data
        ? calculateCostSummary(
            visibleMeta,
            themeSettings.costIgnoredNodes,
            rateQuery.data.rates,
            themeSettings.costPremiums,
            now,
          )
        : null,
    [costsVisible, now, visibleMeta, themeSettings.costIgnoredNodes, themeSettings.costPremiums, rateQuery.data],
  );
  const costLoading = costOverviewNeeded && rateQuery.isLoading;
  const groupOptions = useMemo(() => getHomeGroupOptions(visibleNodes), [visibleNodes]);
  const groupFilteredNodes = useMemo(
    () =>
      selectedGroup === HOME_ALL_GROUP
        ? visibleNodes
        : visibleNodes.filter((node) => getHomeGroupLabel(node.group) === selectedGroup),
    [visibleNodes, selectedGroup],
  );
  const regionOptions = useMemo(
    () => getHomeRegionOptions(groupFilteredNodes),
    [groupFilteredNodes],
  );
  const filteredNodes = useMemo(
    () =>
      selectedRegion === HOME_ALL_REGION
        ? groupFilteredNodes
        : groupFilteredNodes.filter((node) => getDisplayRegionCode(node.region) === selectedRegion),
    [groupFilteredNodes, selectedRegion],
  );
  useEffect(() => {
    if (selectedGroup !== HOME_ALL_GROUP && !groupOptions.includes(selectedGroup)) {
      setSelectedGroup(HOME_ALL_GROUP);
    }
  }, [groupOptions, selectedGroup]);

  useEffect(() => {
    if (
      selectedRegion !== HOME_ALL_REGION &&
      !regionOptions.some((option) => option.code === selectedRegion)
    ) {
      setSelectedRegion(HOME_ALL_REGION);
    }
  }, [regionOptions, selectedRegion]);

  useEffect(() => {
    if (!themeSettings.showRegionBar && selectedRegion !== HOME_ALL_REGION) {
      setSelectedRegion(HOME_ALL_REGION);
    }
  }, [themeSettings.showRegionBar, selectedRegion]);

  useEffect(() => {
    if (!themeSettings.showGroupTabs && selectedGroup !== HOME_ALL_GROUP) {
      setSelectedGroup(HOME_ALL_GROUP);
    }
  }, [themeSettings.showGroupTabs, selectedGroup]);

  // 仅随 UUID 集合/顺序重算列表，实时数据由各卡片自行订阅
  const uuidsKey = useMemo(
    () => filteredNodes.map((node) => node.uuid).join(UUID_KEY_SEPARATOR),
    [filteredNodes],
  );
  const orderedUuids = useMemo(
    () => (uuidsKey ? uuidsKey.split(UUID_KEY_SEPARATOR) : []),
    [uuidsKey],
  );
  const cards = useMemo(
    () =>
      orderedUuids.map((uuid) => (
        <div key={uuid} className="min-w-0">
          {mode === "compact" ? (
            <CompactNodeCard uuid={uuid} showCosts={costsVisible} />
          ) : (
            <NodeCard uuid={uuid} showCosts={costsVisible} />
          )}
        </div>
      )),
    [orderedUuids, mode, costsVisible],
  );
  const mapBackgroundEnabled =
    themeSettings.isReady && themeSettings.enableMapBackground && device === "desktop" && !mapFailed;
  const { className: gridClassName, minColumnWidth } = GRID_LAYOUT[mode];
  const gridTemplateStyle = useMemo(
    () => ({
      gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${minColumnWidth}px), 1fr))`,
    }),
    [minColumnWidth],
  );
  const gridElement = (
    <div className={gridClassName} style={gridTemplateStyle}>
      {cards}
    </div>
  );
  const showGroupTabs =
    themeSettings.isReady && themeSettings.showGroupTabs && groupOptions.length > 0;
  const showRegionBar =
    themeSettings.isReady && themeSettings.showRegionBar && regionOptions.length > 1;
  if (!themeSettings.isReady || !storeHydrated) {
    if (!nodeInfoError) return null;
    return (
      <div
        className="flex h-[40vh] flex-col items-center justify-center gap-2 text-[var(--text-tertiary)]"
        aria-live="polite"
      >
        <span className="text-[14px]">节点数据暂时无法加载</span>
        <span className="text-[12px]">正在等待后端自动重试</span>
      </div>
    );
  }

  const homeOverview = showHomeOverview && (
    <HomeOverviewCards
      visibleUuidSet={visibleUuidSet}
      mapBackground={mapBackgroundEnabled}
      showDetailButton={showCostDetailButton}
      showCosts={costsVisible}
      renewalNodes={renewalNodes}
      costSummary={costSummary}
      costLoading={costLoading}
    />
  );

  const homeHeader = (
    <>
      <HomeBrand siteName={siteName} />
      {mapBackgroundEnabled ? (
        <>
          <ErrorBoundary fallback={null} onError={() => setMapFailed(true)}>
            <Suspense fallback={null}>
              <NodeMapBackground nodes={visibleNodes} />
            </Suspense>
          </ErrorBoundary>
          <div className={`${gridClassName} home-map-header`} style={gridTemplateStyle}>
            {homeOverview}
          </div>
        </>
      ) : (
        homeOverview
      )}
    </>
  );

  if (visibleNodes.length === 0) {
    return (
      <>
        {homeHeader}
        <div className="pointer-events-none flex h-[40vh] flex-col items-center justify-center gap-2 text-[var(--text-tertiary)]">
          <span className="text-[15px]">尚未连接到任何节点</span>
          <span className="text-[12px]">等待后端推送或前往管理后台添加</span>
        </div>
      </>
    );
  }

  return (
    <>
      {homeHeader}
      {showGroupTabs && (
        <div
          className={
            mapBackgroundEnabled
              ? `${gridClassName} home-controls-bar mb-4`
              : "home-controls-bar mb-4"
          }
          style={mapBackgroundEnabled ? gridTemplateStyle : undefined}
        >
          <GroupTabs
            groups={groupOptions}
            selectedGroup={selectedGroup}
            onSelectGroup={setSelectedGroup}
          />
        </div>
      )}
      {showRegionBar && (
        <RegionTabs
          regions={regionOptions}
          selectedRegion={selectedRegion}
          onSelectRegion={setSelectedRegion}
          mapGridClassName={mapBackgroundEnabled ? gridClassName : undefined}
          mapGridStyle={mapBackgroundEnabled ? gridTemplateStyle : undefined}
        />
      )}
      {gridElement}
    </>
  );
}
