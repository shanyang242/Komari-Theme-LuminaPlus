import type { ThemeSettings } from "@/types/komari";
import {
  DEFAULT_BACKGROUND_ALIGNMENT,
  DEFAULT_SURFACE_OPACITY,
  normalizeBackgroundAlignment,
  normalizeBackgroundUrl,
  normalizeSurfaceOpacity,
} from "@/utils/background";
import {
  DEFAULT_COST_RATE_API_URL,
  normalizeCostIgnoredNodes,
  normalizeCostPremiums,
  normalizeCostRateApiUrl,
  type CostPremiumEntry,
} from "@/utils/cost";
import { normalizeNodeIdentityList } from "@/utils/nodeIdentity";
import {
  normalizeHomepageMultiPingTaskIds,
  normalizeHomepageMultiPingNodeTaskIds,
  normalizeHomepagePingTaskBindings,
  type HomepageMultiPingNodeTaskIds,
  type HomepagePingTaskBindings,
} from "@/utils/pingTasks";

export type Appearance = "system" | "light" | "dark";
export type NodeViewMode = "large" | "compact";
export type AmbientEffect =
  | "sakura"
  | "rain"
  | "fireworks";

export const AMBIENT_EFFECTS: readonly AmbientEffect[] = [
  "sakura",
  "rain",
  "fireworks",
];

export interface ResolvedThemeSettings {
  defaultAppearance: Appearance;
  desktopNodeViewMode: NodeViewMode;
  mobileNodeViewMode: NodeViewMode;
  enableAdminButton: boolean;
  hideAdminEntryWhenLoggedOut: boolean;
  showPingChart: boolean;
  homepagePingBindings: HomepagePingTaskBindings;
  enableHomepageMultiPing: boolean;
  homepageMultiPingTaskIds: number[];
  homepageMultiPingNodeTaskIds: HomepageMultiPingNodeTaskIds;
  fakePingForUnbound: boolean;
  enableHomeHeaderAutoHide: boolean;
  homeHeaderVisibleSeconds: number;
  showHomeOverview: boolean;
  showGroupTabs: boolean;
  showRegionBar: boolean;
  showCardGroup: boolean;
  showCostsToGuests: boolean;
  showCostSummary: boolean;
  compactShowTrafficTotal: boolean;
  compactShowBilling: boolean;
  compactShowUptime: boolean;
  hiddenNodes: string[];
  costIgnoredNodes: string[];
  costPremiums: Record<string, CostPremiumEntry>;
  costRateApiUrl: string;
  enableBackgroundImage: boolean;
  backgroundImage: string;
  backgroundImageMobile: string;
  backgroundAlignment: string;
  surfaceOpacity: number;
  enableAmbientEffect: boolean;
  ambientEffect: AmbientEffect;
}

export const DEFAULT_THEME_SETTINGS: ResolvedThemeSettings = {
  defaultAppearance: "system",
  desktopNodeViewMode: "large",
  mobileNodeViewMode: "compact",
  enableAdminButton: true,
  hideAdminEntryWhenLoggedOut: false,
  showPingChart: true,
  homepagePingBindings: {},
  enableHomepageMultiPing: false,
  homepageMultiPingTaskIds: [],
  homepageMultiPingNodeTaskIds: {},
  fakePingForUnbound: false,
  enableHomeHeaderAutoHide: false,
  homeHeaderVisibleSeconds: 10,
  showHomeOverview: true,
  showGroupTabs: true,
  showRegionBar: true,
  showCardGroup: true,
  showCostsToGuests: true,
  showCostSummary: true,
  compactShowTrafficTotal: true,
  compactShowBilling: true,
  compactShowUptime: true,
  hiddenNodes: [],
  costIgnoredNodes: [],
  costPremiums: {},
  costRateApiUrl: DEFAULT_COST_RATE_API_URL,
  enableBackgroundImage: true,
  backgroundImage: "",
  backgroundImageMobile: "",
  backgroundAlignment: DEFAULT_BACKGROUND_ALIGNMENT,
  surfaceOpacity: DEFAULT_SURFACE_OPACITY,
  enableAmbientEffect: false,
  ambientEffect: "sakura",
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

export function normalizeHomeHeaderVisibleSeconds(value: unknown) {
  const seconds =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseFloat(value)
        : Number.NaN;
  if (!Number.isFinite(seconds)) return DEFAULT_THEME_SETTINGS.homeHeaderVisibleSeconds;
  return Math.min(3600, Math.max(1, Math.round(seconds)));
}

export function shouldShowAdminEntry(
  settings: Pick<
    ResolvedThemeSettings,
    "enableAdminButton" | "hideAdminEntryWhenLoggedOut"
  >,
  loggedIn: boolean,
) {
  // enableAdminButton 是旧版隐藏字段，继续保留其全局禁用语义；新设置只对未登录访客生效。
  return (
    settings.enableAdminButton &&
    (loggedIn || !settings.hideAdminEntryWhenLoggedOut)
  );
}

export function canViewCosts(
  settings: Pick<ResolvedThemeSettings, "showCostsToGuests"> & {
    isReady: boolean;
    isError: boolean;
  },
  loggedIn: boolean,
) {
  // 配置尚未读取或读取失败时，不能用默认的公开值展示费用。
  return settings.isReady && !settings.isError && (loggedIn || settings.showCostsToGuests);
}

export function isAmbientEffect(value: unknown): value is AmbientEffect {
  return typeof value === "string" && AMBIENT_EFFECTS.includes(value as AmbientEffect);
}

function normalizeAmbientEffect(value: unknown): AmbientEffect {
  return isAmbientEffect(value) ? value : DEFAULT_THEME_SETTINGS.ambientEffect;
}

export function normalizeThemeSettings(
  settings: (ThemeSettings & Record<string, unknown>) | null | undefined,
): ResolvedThemeSettings {
  const homepageMultiPingTaskIds = normalizeHomepageMultiPingTaskIds(
    settings?.homepageMultiPingTaskIds,
  );
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
    hideAdminEntryWhenLoggedOut:
      settings?.hideAdminEntryWhenLoggedOut === true,
    showPingChart: enabledUnlessFalse(settings?.showPingChart),
    homepagePingBindings: normalizeHomepagePingTaskBindings(settings?.homepagePingBindings),
    // 保留开关原值，让管理页能呈现并修复不完整配置；首页消费方仅在任务恰好为三项时启用。
    enableHomepageMultiPing: settings?.enableHomepageMultiPing === true,
    homepageMultiPingTaskIds,
    homepageMultiPingNodeTaskIds: normalizeHomepageMultiPingNodeTaskIds(
      settings?.homepageMultiPingNodeTaskIds,
    ),
    // 默认关闭(需手动开启):给访客展示的是模拟数据,必须由站长显式决定。
    fakePingForUnbound: settings?.fakePingForUnbound === true,
    enableHomeHeaderAutoHide: settings?.enableHomeHeaderAutoHide === true,
    homeHeaderVisibleSeconds: normalizeHomeHeaderVisibleSeconds(
      settings?.homeHeaderVisibleSeconds,
    ),
    showHomeOverview: enabledUnlessFalse(settings?.showHomeOverview),
    showGroupTabs: enabledUnlessFalse(settings?.showGroupTabs),
    showRegionBar: enabledUnlessFalse(settings?.showRegionBar),
    showCardGroup: enabledUnlessFalse(settings?.showCardGroup),
    // 默认公开以保持存量站点升级后的展示行为；站长可显式关闭访客费用展示。
    showCostsToGuests: enabledUnlessFalse(settings?.showCostsToGuests),
    showCostSummary: enabledUnlessFalse(settings?.showCostSummary),
    compactShowTrafficTotal: enabledUnlessFalse(settings?.compactShowTrafficTotal),
    compactShowBilling: enabledUnlessFalse(settings?.compactShowBilling),
    compactShowUptime: enabledUnlessFalse(settings?.compactShowUptime),
    hiddenNodes: normalizeNodeIdentityList(settings?.hiddenNodes),
    costIgnoredNodes: normalizeCostIgnoredNodes(settings?.costIgnoredNodes),
    costPremiums: normalizeCostPremiums(settings?.costPremiums),
    costRateApiUrl: normalizeCostRateApiUrl(settings?.costRateApiUrl),
    // 默认开:让已配置背景图的存量站点升级后行为不变;关闭 = 保留 URL 但不加载背景图。
    enableBackgroundImage: enabledUnlessFalse(settings?.enableBackgroundImage),
    backgroundImage: normalizeBackgroundUrl(settings?.backgroundImage),
    backgroundImageMobile: normalizeBackgroundUrl(settings?.backgroundImageMobile),
    backgroundAlignment: normalizeBackgroundAlignment(settings?.backgroundAlignment),
    surfaceOpacity: normalizeSurfaceOpacity(settings?.surfaceOpacity),
    // 环境动效默认关闭；保存的预设仍会保留，方便站长关闭后再次开启。
    enableAmbientEffect: settings?.enableAmbientEffect === true,
    ambientEffect: normalizeAmbientEffect(settings?.ambientEffect),
  };
}
