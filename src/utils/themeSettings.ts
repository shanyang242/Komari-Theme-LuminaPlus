import type { ThemeSettings } from "@/types/komari";
import { DEFAULT_COST_RATE_API_URL, normalizeCostIgnoredNodes, normalizeCostRateApiUrl } from "@/utils/cost";
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
  showCostSummary: boolean;
  compactShowTrafficTotal: boolean;
  compactShowBilling: boolean;
  costIgnoredNodes: string[];
  costRateApiUrl: string;
}

export const DEFAULT_THEME_SETTINGS: ResolvedThemeSettings = {
  defaultAppearance: "system",
  desktopNodeViewMode: "large",
  mobileNodeViewMode: "compact",
  enableAdminButton: true,
  showPingChart: true,
  homepagePingBindings: {},
  showCostSummary: true,
  compactShowTrafficTotal: true,
  compactShowBilling: true,
  costIgnoredNodes: [],
  costRateApiUrl: DEFAULT_COST_RATE_API_URL,
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
    showCostSummary: enabledUnlessFalse(settings?.showCostSummary),
    compactShowTrafficTotal: enabledUnlessFalse(settings?.compactShowTrafficTotal),
    compactShowBilling: enabledUnlessFalse(settings?.compactShowBilling),
    costIgnoredNodes: normalizeCostIgnoredNodes(settings?.costIgnoredNodes),
    costRateApiUrl: normalizeCostRateApiUrl(settings?.costRateApiUrl),
  };
}
