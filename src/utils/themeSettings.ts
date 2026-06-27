import type { ThemeSettings } from "@/types/komari";
import {
  DEFAULT_BACKGROUND_ALIGNMENT,
  DEFAULT_SURFACE_OPACITY,
  normalizeBackgroundAlignment,
  normalizeBackgroundUrl,
  normalizeSurfaceOpacity,
} from "@/utils/background";
import { DEFAULT_COST_RATE_API_URL, normalizeCostIgnoredNodes, normalizeCostRateApiUrl } from "@/utils/cost";
import { normalizeNodeIdentityList } from "@/utils/nodeIdentity";
import { normalizeHomeGroupOrder } from "@/utils/homeNodes";
import {
  HOME_SORT_NATURAL_DIRECTION,
  isHomeSortDirection,
  isHomeSortField,
  type HomeSortDirection,
  type HomeSortField,
} from "@/utils/homeSort";
import {
  isOverviewRatingStyle,
  type OverviewRatingStyle,
} from "@/utils/overviewRating";
import { normalizeHomepagePingTaskBindings, type HomepagePingTaskBindings } from "@/utils/pingTasks";

export type Appearance = "system" | "light" | "dark";
export type NodeViewMode = "large" | "compact";

export interface ResolvedThemeSettings {
  defaultAppearance: Appearance;
  desktopNodeViewMode: NodeViewMode;
  mobileNodeViewMode: NodeViewMode;
  enableAdminButton: boolean;
  showPingChart: boolean;
  homepagePingBindings: HomepagePingTaskBindings;
  showHomeOverview: boolean;
  showGroupTabs: boolean;
  homeGroupOrder: string[];
  enableHomeSort: boolean;
  homeSortField: HomeSortField;
  homeSortDirection: HomeSortDirection;
  showCostSummary: boolean;
  showCostSummaryFloatingButton: boolean;
  showOverviewRatings: boolean;
  overviewRatingStyle: OverviewRatingStyle;
  showTrafficRating: boolean;
  showBandwidthRating: boolean;
  showAssetRating: boolean;
  trafficRatingLabels: string;
  bandwidthRatingLabels: string;
  assetRatingLabels: string;
  compactShowTrafficTotal: boolean;
  compactShowBilling: boolean;
  compactShowUptime: boolean;
  showConnections: boolean;
  hiddenNodes: string[];
  costIgnoredNodes: string[];
  costRateApiUrl: string;
  backgroundImage: string;
  backgroundImageMobile: string;
  backgroundAlignment: string;
  surfaceOpacity: number;
}

export const DEFAULT_THEME_SETTINGS: ResolvedThemeSettings = {
  defaultAppearance: "system",
  desktopNodeViewMode: "large",
  mobileNodeViewMode: "compact",
  enableAdminButton: true,
  showPingChart: true,
  homepagePingBindings: {},
  showHomeOverview: true,
  showGroupTabs: true,
  homeGroupOrder: [],
  enableHomeSort: true,
  homeSortField: "default",
  homeSortDirection: HOME_SORT_NATURAL_DIRECTION.default,
  showCostSummary: true,
  showCostSummaryFloatingButton: true,
  showOverviewRatings: true,
  overviewRatingStyle: "plain",
  showTrafficRating: true,
  showBandwidthRating: true,
  showAssetRating: true,
  trafficRatingLabels: "",
  bandwidthRatingLabels: "",
  assetRatingLabels: "",
  compactShowTrafficTotal: true,
  compactShowBilling: true,
  compactShowUptime: true,
  showConnections: false,
  hiddenNodes: [],
  costIgnoredNodes: [],
  costRateApiUrl: DEFAULT_COST_RATE_API_URL,
  backgroundImage: "",
  backgroundImageMobile: "",
  backgroundAlignment: DEFAULT_BACKGROUND_ALIGNMENT,
  surfaceOpacity: DEFAULT_SURFACE_OPACITY,
};

export function isAppearance(value: unknown): value is Appearance {
  return value === "system" || value === "light" || value === "dark";
}

function normalizeAppearance(
  value: unknown,
  fallback: Appearance = DEFAULT_THEME_SETTINGS.defaultAppearance,
): Appearance {
  return isAppearance(value) ? value : fallback;
}

export function isNodeViewMode(value: unknown): value is NodeViewMode {
  return value === "large" || value === "compact";
}

function normalizeNodeViewMode(
  value: unknown,
  fallback: NodeViewMode,
): NodeViewMode {
  return isNodeViewMode(value) ? value : fallback;
}

function enabledUnlessFalse(value: unknown) {
  return value !== false;
}

function normalizePlainText(value: unknown) {
  return typeof value === "string" ? value : "";
}

// 管理员默认排序:字段非法回落 default;方向非法时回落该字段的自然方向(文本升、数值降)。
function normalizeHomeSortDefault(
  field: unknown,
  direction: unknown,
): { homeSortField: HomeSortField; homeSortDirection: HomeSortDirection } {
  const homeSortField = isHomeSortField(field) ? field : "default";
  return {
    homeSortField,
    homeSortDirection: isHomeSortDirection(direction)
      ? direction
      : HOME_SORT_NATURAL_DIRECTION[homeSortField],
  };
}

export function normalizeThemeSettings(
  settings: (ThemeSettings & Record<string, unknown>) | null | undefined,
): ResolvedThemeSettings {
  return {
    defaultAppearance: normalizeAppearance(settings?.defaultAppearance),
    desktopNodeViewMode: normalizeNodeViewMode(
      settings?.desktopNodeViewMode,
      DEFAULT_THEME_SETTINGS.desktopNodeViewMode,
    ),
    mobileNodeViewMode: normalizeNodeViewMode(
      settings?.mobileNodeViewMode,
      DEFAULT_THEME_SETTINGS.mobileNodeViewMode,
    ),
    enableAdminButton: enabledUnlessFalse(settings?.enableAdminButton),
    showPingChart: enabledUnlessFalse(settings?.showPingChart),
    homepagePingBindings: normalizeHomepagePingTaskBindings(settings?.homepagePingBindings),
    showHomeOverview: enabledUnlessFalse(settings?.showHomeOverview),
    showGroupTabs: enabledUnlessFalse(settings?.showGroupTabs),
    homeGroupOrder: normalizeHomeGroupOrder(settings?.homeGroupOrder),
    enableHomeSort: enabledUnlessFalse(settings?.enableHomeSort),
    ...normalizeHomeSortDefault(settings?.homeSortField, settings?.homeSortDirection),
    showCostSummary: enabledUnlessFalse(settings?.showCostSummary),
    showCostSummaryFloatingButton: enabledUnlessFalse(settings?.showCostSummaryFloatingButton),
    showOverviewRatings: enabledUnlessFalse(settings?.showOverviewRatings),
    overviewRatingStyle: isOverviewRatingStyle(settings?.overviewRatingStyle)
      ? settings.overviewRatingStyle
      : DEFAULT_THEME_SETTINGS.overviewRatingStyle,
    showTrafficRating: enabledUnlessFalse(settings?.showTrafficRating),
    showBandwidthRating: enabledUnlessFalse(settings?.showBandwidthRating),
    showAssetRating: enabledUnlessFalse(settings?.showAssetRating),
    trafficRatingLabels: normalizePlainText(settings?.trafficRatingLabels),
    bandwidthRatingLabels: normalizePlainText(settings?.bandwidthRatingLabels),
    assetRatingLabels: normalizePlainText(settings?.assetRatingLabels),
    compactShowTrafficTotal: enabledUnlessFalse(settings?.compactShowTrafficTotal),
    compactShowBilling: enabledUnlessFalse(settings?.compactShowBilling),
    compactShowUptime: enabledUnlessFalse(settings?.compactShowUptime),
    // 默认关闭(需手动开启):连接数是个小众指标,很多 agent 也不上报,所以只在显式启用时才显示。
    showConnections: settings?.showConnections === true,
    hiddenNodes: normalizeNodeIdentityList(settings?.hiddenNodes),
    costIgnoredNodes: normalizeCostIgnoredNodes(settings?.costIgnoredNodes),
    costRateApiUrl: normalizeCostRateApiUrl(settings?.costRateApiUrl),
    backgroundImage: normalizeBackgroundUrl(settings?.backgroundImage),
    backgroundImageMobile: normalizeBackgroundUrl(settings?.backgroundImageMobile),
    backgroundAlignment: normalizeBackgroundAlignment(settings?.backgroundAlignment),
    surfaceOpacity: normalizeSurfaceOpacity(settings?.surfaceOpacity),
  };
}
