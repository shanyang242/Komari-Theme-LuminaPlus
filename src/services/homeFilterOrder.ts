import type { ThemeSettings } from "@/types/komari";
import { getPublic, saveThemeSettings } from "@/services/api";
import {
  mergeHomeOptionOrder,
  normalizeHomeGroupOrder,
  normalizeHomeRegionOrder,
  sortHomeGroupOptions,
} from "@/utils/homeNodes";

export type HomeFilterOrderField = "homeGroupOrder" | "homeRegionOrder";

export interface HomeFilterOrderChange {
  field: HomeFilterOrderField;
  visibleOrder: readonly string[];
  availableOrder: readonly string[];
}

export function buildHomeFilterOrderSettings(
  settings: (ThemeSettings & Record<string, unknown>) | null | undefined,
  { field, visibleOrder, availableOrder }: HomeFilterOrderChange,
): ThemeSettings & Record<string, unknown> {
  const normalize = field === "homeGroupOrder"
    ? normalizeHomeGroupOrder
    : normalizeHomeRegionOrder;
  const stored = normalize(settings?.[field]);
  // 首次在某个分组内排序时，也保留其他分组的地区在全站顺序里的位置。
  const available = sortHomeGroupOptions(normalize(availableOrder), stored);
  const completeOrder = mergeHomeOptionOrder(stored, available);
  return {
    ...settings,
    [field]: mergeHomeOptionOrder(completeOrder, normalize(visibleOrder)),
  };
}

export async function persistHomeFilterOrder(
  theme: string,
  change: HomeFilterOrderChange,
): Promise<string[]> {
  // 保存接口接收整份设置；先取服务端最新值，避免覆盖其他页面刚保存的配置。
  const latest = await getPublic();
  if (latest.theme !== theme) {
    throw new Error("站点主题已切换，请刷新页面后重试。");
  }
  const settings = buildHomeFilterOrderSettings(latest.theme_settings, change);
  await saveThemeSettings(theme, settings);
  return settings[change.field] ?? [];
}
