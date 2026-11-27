import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  CircleDollarSign,
  EyeOff,
  Grid3x3,
  ImageIcon,
  LayoutTemplate,
  LayoutGrid,
  List,
  ListFilter,
  Moon,
  RefreshCw,
  Rows3,
  Save,
  Search,
  SlidersHorizontal,
  Sparkles,
  Store,
  Sun,
  SunMoon,
  Video,
  Wallpaper,
} from "lucide-react";
import { clsx } from "clsx";
import { InstancePanel } from "@/components/instance/InstancePanel";
import { MultiPingNodeConfigPanel } from "@/components/theme/MultiPingNodeConfigPanel";
import { MerchantLinkConfigPanel } from "@/components/theme/MerchantLinkConfigPanel";
import { TrafficResetConfigPanel } from "@/components/theme/TrafficResetConfigPanel";
import { Spinner } from "@/components/ui/Spinner";
import { Flag } from "@/components/ui/Flag";
import { usePublicConfig } from "@/hooks/usePublicConfig";
import { useAdminEntryPath } from "@/hooks/useAdminEntryPath";
import { useHourlyClock } from "@/hooks/useClock";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { MOBILE_VIEWPORT_QUERY } from "@/utils/mediaQuery";
import { formatLocalDateKey } from "@/utils/format";
import { queryClient } from "@/services/queryClient";
import {
  ApiRequestError,
  getAdminClients,
  getAdminPingTasks,
  getNodes,
  getPublic,
  saveThemeSettings,
} from "@/services/api";
import type { AdminClient, PingTask, PublicConfig, ThemeSettings } from "@/types/komari";
import {
  DEFAULT_BACKGROUND_VIDEO_URL,
  type BackgroundPosition,
  type BackgroundSize,
  isBackgroundUrlValid,
  normalizeBackgroundAlignment,
  normalizeBackgroundUrl,
  normalizeBackgroundVideoUrl,
  normalizeSurfaceOpacity,
  parseBackgroundAlignment,
} from "@/utils/background";
import {
  calculateCostSummary,
  calculateCostPremiumAmount,
  calculateCostPremiumBasisAt,
  formatCnyMoney,
  formatSignedCny,
  getExchangeRates,
  isCostRateApiUrlValid,
  normalizeCostIgnoredNodes,
  normalizeCostPremiums,
  normalizeCostRateApiUrl,
  type CostPremiumEntry,
} from "@/utils/cost";
import { normalizeNodeIdentityList } from "@/utils/nodeIdentity";
import {
  hasInvalidMerchantLinks,
  normalizeNodeMerchantLinks,
  sanitizeMerchantUrl,
  type NodeMerchantLinks,
} from "@/utils/merchantLinks";
import { normalizeTrafficResetDays } from "@/utils/trafficReset";
import {
  HOMEPAGE_MULTI_PING_TASK_COUNT,
  normalizeHomepageMultiPingNodeTaskIds,
  normalizeHomepageMultiPingTaskIds,
  normalizeHomepagePingTaskBindings,
  type HomepageMultiPingNodeTaskIds,
  type HomepagePingTaskBindings,
} from "@/utils/pingTasks";
import {
  DEFAULT_THEME_SETTINGS,
  normalizeHomeHeaderVisibleSeconds,
  normalizeThemeSettings,
  type AmbientEffect,
  type BackgroundMediaType,
  type ResolvedThemeSettings,
} from "@/utils/themeSettings";
import {
  getDefaultOverviewRatingLabelText,
  type OverviewRatingKind,
} from "@/utils/overviewRating";
import { HOME_SORT_FIELDS, HOME_SORT_FIELD_LABELS } from "@/utils/homeSort";

const APPEARANCE_OPTIONS = [
  { value: "light", label: "浅色", icon: Sun },
  { value: "system", label: "跟随系统", icon: SunMoon },
  { value: "dark", label: "深色", icon: Moon },
] as const;
const NODE_VIEW_MODE_OPTIONS = [
  { value: "large", label: "大卡片", icon: LayoutGrid },
  { value: "compact", label: "小卡片", icon: Rows3 },
  { value: "mini", label: "迷你卡片", icon: Grid3x3 },
  { value: "list", label: "列表", icon: List },
] as const;
const MOBILE_VIEW_MODE_OPTIONS = NODE_VIEW_MODE_OPTIONS.filter((option) => option.value !== "list");
const BACKGROUND_MEDIA_TYPE_OPTIONS: Array<{
  value: BackgroundMediaType;
  label: string;
  icon: typeof ImageIcon;
}> = [
  { value: "image", label: "图片", icon: ImageIcon },
  { value: "video", label: "视频", icon: Video },
];
const BACKGROUND_SIZE_OPTIONS: Array<{ value: BackgroundSize; label: string }> = [
  { value: "cover", label: "填满" },
  { value: "contain", label: "完整" },
  { value: "auto", label: "原始" },
];
const BACKGROUND_POSITION_OPTIONS: Array<{ value: BackgroundPosition; label: string }> = [
  { value: "top", label: "顶部" },
  { value: "center", label: "居中" },
  { value: "bottom", label: "底部" },
];
const AMBIENT_EFFECT_OPTIONS: Array<{
  value: AmbientEffect;
  label: string;
}> = [
  { value: "sakura", label: "樱花飘落" },
  { value: "rain", label: "细雨" },
  { value: "snow", label: "缓雪" },
  { value: "leaves", label: "秋叶飘落" },
  { value: "confetti", label: "庆典彩纸" },
  { value: "fireworks", label: "烟花" },
];

function localDateInputMax() {
  return formatLocalDateKey(Date.now());
}

const OVERVIEW_RATING_LABEL_FIELDS: Array<{
  key: OverviewRatingKind;
  title: string;
  toggleKey: "showTrafficRating" | "showBandwidthRating" | "showAssetRating";
}> = [
  { key: "traffic", title: "累计流量", toggleKey: "showTrafficRating" },
  { key: "bandwidth", title: "实时带宽", toggleKey: "showBandwidthRating" },
  { key: "asset", title: "资产概览", toggleKey: "showAssetRating" },
];

function sortTasks(tasks: PingTask[]) {
  return [...tasks].sort((left, right) => {
    if (left.weight !== right.weight) return left.weight - right.weight;
    if (left.id !== right.id) return left.id - right.id;
    return left.name.localeCompare(right.name);
  });
}

function buildPremiumEntry(
  amount: number,
  paidCny?: number,
  acquiredAt?: string,
): CostPremiumEntry {
  return {
    amount,
    ...(paidCny != null ? { paidCny } : {}),
    ...(acquiredAt ? { acquiredAt } : {}),
  };
}

function sortClients(clients: AdminClient[]) {
  return [...clients].sort((left, right) => {
    if (left.weight !== right.weight) return left.weight - right.weight;
    return left.name.localeCompare(right.name);
  });
}

function filterClients(clients: AdminClient[], rawKeyword: string) {
  const keyword = rawKeyword.trim().toLowerCase();
  if (!keyword) return clients;
  return clients.filter((client) => {
    const group = String(client.group || "").toLowerCase();
    const region = String(client.region || "").toLowerCase();
    return (
      client.name.toLowerCase().includes(keyword) ||
      client.uuid.toLowerCase().includes(keyword) ||
      group.includes(keyword) ||
      region.includes(keyword)
    );
  });
}

function summarizeNodes(
  uuids: string[],
  clientsById: Map<string, AdminClient>,
) {
  if (uuids.length === 0) return "未绑定节点";
  const names = uuids.map((uuid) => clientsById.get(uuid)?.name || uuid);
  const summary = names.join("、");
  return summary.length > 92 ? `${summary.slice(0, 92)}...` : summary;
}

function pruneBindings(bindings: HomepagePingTaskBindings) {
  const normalized = normalizeHomepagePingTaskBindings(bindings);
  const pruned: HomepagePingTaskBindings = {};

  for (const [taskId, clients] of Object.entries(normalized)) {
    if (clients.length > 0) {
      pruned[taskId] = clients;
    }
  }

  return pruned;
}

function applyClientAssignment(
  bindings: HomepagePingTaskBindings,
  taskId: number,
  clientUuid: string,
  checked: boolean,
) {
  const taskKey = String(taskId);
  const next = pruneBindings(bindings);

  for (const [currentTaskId, clients] of Object.entries(next)) {
    const filtered = clients.filter((uuid) => uuid !== clientUuid);
    if (filtered.length > 0) {
      next[currentTaskId] = filtered;
    } else {
      delete next[currentTaskId];
    }
  }

  if (checked) {
    const selected = next[taskKey] ?? [];
    next[taskKey] = Array.from(new Set([...selected, clientUuid])).sort((left, right) =>
      left.localeCompare(right),
    );
  }

  return next;
}

// 反查:client uuid → 所属 task id(字符串 key)。UI 保证每个 client 最多归属一个
// task,所以简单的后写覆盖 map 就是精确的。下面的「全选可用」reducer 和每次渲染的
// 可选节点过滤共用它,把「某 client 归属哪个 task」的推导收在一处。
function invertBindings(bindings: HomepagePingTaskBindings): Map<string, string> {
  const assignedTaskByClient = new Map<string, string>();
  for (const [taskId, clients] of Object.entries(bindings)) {
    for (const clientUuid of clients) {
      assignedTaskByClient.set(clientUuid, taskId);
    }
  }
  return assignedTaskByClient;
}

function applyAvailableClientAssignments(
  bindings: HomepagePingTaskBindings,
  taskId: number,
  clientUuids: string[],
) {
  const taskKey = String(taskId);
  const next = pruneBindings(bindings);
  const assignedTaskByClient = invertBindings(next);
  const selected = new Set(next[taskKey] ?? []);

  for (const clientUuid of clientUuids) {
    const assignedTaskId = assignedTaskByClient.get(clientUuid);
    if (assignedTaskId && assignedTaskId !== taskKey) continue;
    selected.add(clientUuid);
  }

  if (selected.size > 0) {
    next[taskKey] = [...selected].sort((left, right) => left.localeCompare(right));
  } else {
    delete next[taskKey];
  }

  return next;
}

// 本页托管设置的键清单唯一来源:草稿类型(ThemeDraft)、seed(draftFromSettings)与内容签名
// 都从它派生。新增一项设置只需在这里加一行,再到 JSX 里接 patch()。
// 刻意不标注返回类型:让推断给出全字段必填的具体类型,ThemeDraft 才能安全地 Omit/扩展。
function pickManagedThemeSettings(settings: ResolvedThemeSettings) {
  return {
    defaultAppearance: settings.defaultAppearance,
    desktopNodeViewMode: settings.desktopNodeViewMode,
    mobileNodeViewMode: settings.mobileNodeViewMode,
    hideAdminEntryWhenLoggedOut: settings.hideAdminEntryWhenLoggedOut,
    homepagePingBindings: settings.homepagePingBindings,
    enableHomepageMultiPing: settings.enableHomepageMultiPing,
    homepageMultiPingTaskIds: settings.homepageMultiPingTaskIds,
    homepageMultiPingNodeTaskIds: settings.homepageMultiPingNodeTaskIds,
    fakePingForUnbound: settings.fakePingForUnbound,
    enableHomeHeaderAutoHide: settings.enableHomeHeaderAutoHide,
    homeHeaderVisibleSeconds: settings.homeHeaderVisibleSeconds,
    showHomeOverview: settings.showHomeOverview,
    showGroupTabs: settings.showGroupTabs,
    showRegionBar: settings.showRegionBar,
    showCardGroup: settings.showCardGroup,
    enableHomeSort: settings.enableHomeSort,
    homeSortField: settings.homeSortField,
    homeSortDirection: settings.homeSortDirection,
    showCostsToGuests: settings.showCostsToGuests,
    showCostSummary: settings.showCostSummary,
    showCostSummaryFloatingButton: settings.showCostSummaryFloatingButton,
    showOverviewRatings: settings.showOverviewRatings,
    showTrafficRating: settings.showTrafficRating,
    showBandwidthRating: settings.showBandwidthRating,
    showAssetRating: settings.showAssetRating,
    trafficRatingLabels: settings.trafficRatingLabels,
    bandwidthRatingLabels: settings.bandwidthRatingLabels,
    assetRatingLabels: settings.assetRatingLabels,
    compactShowTrafficTotal: settings.compactShowTrafficTotal,
    compactShowBilling: settings.compactShowBilling,
    compactShowUptime: settings.compactShowUptime,
    showConnections: settings.showConnections,
    showTodayTrafficPopover: settings.showTodayTrafficPopover,
    showMerchantLinks: settings.showMerchantLinks,
    nodeMerchantLinks: Object.fromEntries(
      Object.keys(settings.nodeMerchantLinks)
        .sort()
        .map((uuid) => [uuid, settings.nodeMerchantLinks[uuid]]),
    ),
    trafficResetDays: normalizeTrafficResetDays(settings.trafficResetDays),
    hiddenNodes: settings.hiddenNodes,
    costIgnoredNodes: settings.costIgnoredNodes,
    // 按键排序:costPremiums 的键序随编辑历史漂移(删掉再加回同一键会排到最后),而 dirty /
    // reseed 判断都走 JSON.stringify 签名——不排序会把"内容相同、键序不同"误判成有未保存改动。
    costPremiums: Object.fromEntries(
      Object.keys(settings.costPremiums)
        .sort()
        .map((uuid) => [uuid, settings.costPremiums[uuid]]),
    ),
    costRateApiUrl: settings.costRateApiUrl,
    enableBackgroundImage: settings.enableBackgroundImage,
    enableMapBackground: settings.enableMapBackground,
    backgroundMediaType: settings.backgroundMediaType,
    backgroundImage: settings.backgroundImage,
    backgroundImageMobile: settings.backgroundImageMobile,
    backgroundVideo: settings.backgroundVideo,
    backgroundVideoDark: settings.backgroundVideoDark,
    backgroundAlignment: settings.backgroundAlignment,
    surfaceOpacity: settings.surfaceOpacity,
    enableAmbientEffect: settings.enableAmbientEffect,
    ambientEffect: settings.ambientEffect,
  };
}

type ManagedThemeSettings = ReturnType<typeof pickManagedThemeSettings>;

export function patchMultiPingTaskSlots(
  slots: ReadonlyArray<number | null>,
  slot: number,
  rawValue: string,
): Array<number | null> {
  const next = Array.from(
    { length: HOMEPAGE_MULTI_PING_TASK_COUNT },
    (_, index) => slots[index] ?? null,
  );
  if (slot < 0 || slot >= next.length) return next;
  if (rawValue === "") {
    next[slot] = null;
    return next;
  }
  const nextId = Number(rawValue);
  if (!Number.isInteger(nextId) || nextId <= 0) return next;
  const previousId = next[slot];
  const occupiedSlot = next.indexOf(nextId);
  next[slot] = nextId;
  if (occupiedSlot >= 0 && occupiedSlot !== slot) {
    next[occupiedSlot] = previousId ?? null;
  }
  return next;
}

export function mergeManagedThemeSettingsDiff(
  remoteSettings: Record<string, unknown> | undefined,
  baselineManaged: Record<string, unknown>,
  draftManaged: Record<string, unknown>,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...(remoteSettings ?? {}) };
  for (const key of Object.keys(draftManaged)) {
    if (JSON.stringify(draftManaged[key]) !== JSON.stringify(baselineManaged[key])) {
      next[key] = draftManaged[key];
    }
  }
  if ("homepagePingBindings" in next) {
    delete next.homepagePingTask;
  }
  return next;
}

/** 判断远端 public 配置刷新时是否应回灌草稿及基线：已初始化且有未保存编辑时保持原基线。 */
export function shouldReseedThemeDraft(
  lastSeededSignature: string | null,
  sourceSignature: string,
  isDirty: boolean,
): boolean {
  if (lastSeededSignature === sourceSignature) return false;
  if (lastSeededSignature !== null && isDirty) return false;
  return true;
}

/**
 * 保存请求在途期间用户继续编辑时，以刚落库的 savedDraft 为新基线做三方合并：
 * 保留提交之后的新增编辑（含把开关改回保存前原值），同时吸收本次保存合并进来的远端并发修改。
 */
export function rebaseThemeDraftAfterSave<T extends Record<string, unknown>>(
  savedDraft: T,
  submittedDraft: T,
  latestDraft: T,
): T {
  const next = { ...savedDraft };
  for (const key of Object.keys(latestDraft) as Array<keyof T>) {
    if (JSON.stringify(latestDraft[key]) !== JSON.stringify(submittedDraft[key])) {
      next[key] = latestDraft[key];
    }
  }
  return next;
}

function slotsFromTaskIds(ids: number[]): Array<number | null> {
  return Array.from(
    { length: HOMEPAGE_MULTI_PING_TASK_COUNT },
    (_, index) => ids[index] ?? null,
  );
}

// 表单草稿:与托管设置同名同构,编辑态专属字段单独表达(多行列表文本、评级名称映射、
// 允许清空重输的数值字符串、以及固定长度的三网槽位数组)。
type ThemeDraft = Omit<
  ManagedThemeSettings,
  | "hiddenNodes"
  | "costIgnoredNodes"
  | "trafficRatingLabels"
  | "bandwidthRatingLabels"
  | "assetRatingLabels"
  | "surfaceOpacity"
  | "homeHeaderVisibleSeconds"
  | "homepageMultiPingTaskIds"
> & {
  ratingLabels: Record<OverviewRatingKind, string>;
  hiddenNodesText: string;
  costIgnoredText: string;
  surfaceOpacityText: string;
  homeHeaderVisibleSecondsText: string;
  homepageMultiPingTaskSlots: Array<number | null>;
};

// 服务端设置 → 表单草稿。reseed effect 和重置按钮都经 seedDrafts 走这里。
function draftFromSettings(settings: ResolvedThemeSettings): ThemeDraft {
  const {
    hiddenNodes,
    costIgnoredNodes,
    trafficRatingLabels,
    bandwidthRatingLabels,
    assetRatingLabels,
    surfaceOpacity,
    homeHeaderVisibleSeconds,
    homepageMultiPingTaskIds,
    ...rest
  } = pickManagedThemeSettings(settings);
  return {
    ...rest,
    ratingLabels: {
      traffic: trafficRatingLabels,
      bandwidth: bandwidthRatingLabels,
      asset: assetRatingLabels,
    },
    hiddenNodesText: hiddenNodes.join("\n"),
    costIgnoredText: costIgnoredNodes.join("\n"),
    surfaceOpacityText: String(surfaceOpacity),
    homeHeaderVisibleSecondsText: String(homeHeaderVisibleSeconds),
    homepageMultiPingTaskSlots: slotsFromTaskIds(homepageMultiPingTaskIds),
  };
}

type BooleanDraftKey = {
  [K in keyof ThemeDraft]: ThemeDraft[K] extends boolean ? K : never;
}[keyof ThemeDraft];

// 统一的「标题 + 说明 + 开关」行。memo + 稳定的 patch 引用:编辑无关字段的击键不再重渲这些行。
const ToggleRow = memo(function ToggleRow({
  field,
  title,
  desc,
  checked,
  onPatch,
}: {
  field: BooleanDraftKey;
  title: string;
  desc: string;
  checked: boolean;
  onPatch: (key: BooleanDraftKey, value: boolean) => void;
}) {
  return (
    <label className="surface-inset flex items-center justify-between gap-3 px-4 py-3">
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-[var(--text-primary)]">{title}</span>
        <span className="mt-1 block text-[11px] text-[var(--text-tertiary)]">{desc}</span>
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onPatch(field, event.target.checked)}
        className="h-4 w-4 shrink-0 accent-[var(--accent-500)]"
      />
    </label>
  );
});

const EMPTY_ASSIGNED_CLIENTS: string[] = [];
const EMPTY_ADMIN_CLIENTS: AdminClient[] = [];

// 单个 Ping 任务的绑定卡片。memo:编辑无关设置的击键不再重渲任务列表;展开态的
// tasks×clients 复选网格只在绑定/搜索/展开变化时重算。
const TaskBindingSection = memo(function TaskBindingSection({
  task,
  assigned,
  expanded,
  clientsById,
  visibleClients,
  assignedTaskByClientUuid,
  nodeSearch,
  onNodeSearch,
  onToggleExpand,
  onPatchBindings,
}: {
  task: PingTask;
  assigned: string[];
  expanded: boolean;
  clientsById: Map<string, AdminClient>;
  visibleClients: AdminClient[];
  assignedTaskByClientUuid: Map<string, string>;
  nodeSearch: string;
  onNodeSearch: (value: string) => void;
  onToggleExpand: (taskId: number) => void;
  onPatchBindings: (
    updater: (prev: HomepagePingTaskBindings) => HomepagePingTaskBindings,
  ) => void;
}) {
  const assignedSummary = summarizeNodes(assigned, clientsById);
  // 过滤只有展开的任务需要;收起的卡片跳过,搜索输入不再对每个任务做 O(clients) 扫描。
  const selectableVisibleClients = expanded
    ? visibleClients.filter((client) => {
        const assignedTaskId = assignedTaskByClientUuid.get(client.uuid);
        return !assignedTaskId || assignedTaskId === String(task.id);
      })
    : EMPTY_ADMIN_CLIENTS;
  const allVisibleSelectableAssigned =
    selectableVisibleClients.length > 0 &&
    selectableVisibleClients.every((client) => assigned.includes(client.uuid));
  return (
    <section className="surface-inset px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[15px] font-semibold text-[var(--text-primary)]">
              {task.name || `任务 #${task.id}`}
            </h3>
            <span className="rounded-full border border-[var(--hairline)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
              {task.type || "icmp"}
            </span>
            <span className="rounded-full border border-[var(--hairline)] px-2 py-0.5 text-[10px] font-medium text-[var(--text-tertiary)]">
              {task.interval}s
            </span>
            <span className="rounded-full border border-[var(--hairline)] px-2 py-0.5 text-[10px] font-medium text-[var(--text-tertiary)]">
              ID {task.id}
            </span>
          </div>
          <div className="mt-2 text-[12px] text-[var(--text-secondary)]">
            <span className="font-medium text-[var(--text-primary)]">
              已绑定 {assigned.length} 个节点
            </span>
            <span className="mx-2 text-[var(--text-tertiary)]">·</span>
            <span title={task.target || ""}>{task.target || "未填写目标"}</span>
          </div>
          <p className="mt-2 text-[12px] text-[var(--text-tertiary)]" title={assignedSummary}>
            {assignedSummary}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {expanded && (
            <button
              type="button"
              disabled={selectableVisibleClients.length === 0 || allVisibleSelectableAssigned}
              onClick={() => {
                onPatchBindings((prev) =>
                  applyAvailableClientAssignments(
                    prev,
                    task.id,
                    selectableVisibleClients.map((client) => client.uuid),
                  ),
                );
              }}
              className="theme-manage-button is-compact"
            >
              {allVisibleSelectableAssigned ? "已全选可用" : "全选可用"}
            </button>
          )}
          {assigned.length > 0 && (
            <button
              type="button"
              onClick={() => {
                onPatchBindings((prev) => {
                  const next = { ...prev };
                  delete next[String(task.id)];
                  return pruneBindings(next);
                });
              }}
              className="theme-manage-button is-compact is-danger"
            >
              清空节点
            </button>
          )}
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => onToggleExpand(task.id)}
            className="theme-manage-button is-compact"
          >
            {expanded ? "收起节点" : "编辑节点"}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="mt-4 border-t border-[var(--hairline)] pt-4">
          <label className="surface-inset flex items-center gap-2 px-3 py-2">
            <Search size={14} className="text-[var(--text-tertiary)]" />
            <input
              value={nodeSearch}
              onChange={(event) => onNodeSearch(event.target.value)}
              placeholder="搜索节点名称 / UUID / 分组 / 地区"
              aria-label="搜索节点"
              className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-[var(--text-tertiary)]"
            />
          </label>

          <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {visibleClients.map((client) => {
              const checked = assigned.includes(client.uuid);
              const subtitle = [client.group, client.uuid].filter(Boolean).join(" · ");
              return (
                <label
                  key={client.uuid}
                  className={clsx(
                    "flex cursor-pointer items-start gap-3 rounded-[12px] border px-3 py-3 transition-colors",
                    checked
                      ? "border-[var(--border-strong)] bg-[color-mix(in_srgb,var(--hover-bg)_72%,transparent)]"
                      : "border-[var(--hairline)] bg-transparent hover:bg-[var(--hover-bg)]",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => {
                      const nextChecked = event.target.checked;
                      onPatchBindings((prev) =>
                        applyClientAssignment(prev, task.id, client.uuid, nextChecked),
                      );
                    }}
                    className="mt-1 h-4 w-4 shrink-0 accent-[var(--accent-500)]"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Flag region={client.region} size={14} />
                      <span className="truncate text-[13px] font-medium text-[var(--text-primary)]">
                        {client.name}
                      </span>
                    </div>
                    <div className="mt-1 text-[11px] text-[var(--text-tertiary)]">
                      {subtitle || client.region || "未设置分组"}
                    </div>
                  </div>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
});

type PremiumDetail = ReturnType<typeof calculateCostSummary>["details"][number];

// 溢价录入列表。memo:编辑其他设置的击键不重渲整表——引用变化只来自
// costPremiums 切片、搜索结果与汇率加载态。
const PremiumList = memo(function PremiumList({
  clients,
  costPremiums,
  detailByUuid,
  rateLoading,
  acquiredAtMax,
  onPatchPaid,
  onPatchAcquiredAt,
}: {
  clients: AdminClient[];
  costPremiums: ThemeDraft["costPremiums"];
  detailByUuid: Map<string, PremiumDetail>;
  rateLoading: boolean;
  acquiredAtMax: string;
  onPatchPaid: (uuid: string, rawValue: string) => void;
  onPatchAcquiredAt: (uuid: string, rawValue: string) => void;
}) {
  return (
    <div className="surface-inset max-h-[320px] overflow-y-auto">
      {clients.map((client) => {
        const entry = costPremiums[client.uuid];
        const detail = detailByUuid.get(client.uuid);
        const referenceLabel = rateLoading
          ? "计算中"
          : detail
            ? detail.counted
              ? formatCnyMoney(detail.remainingCny)
              : detail.note || "--"
            : "--";
        const canCompute = detail != null && (detail.counted || detail.note === "免费");
        return (
          <div
            key={client.uuid}
            className="flex items-center justify-between gap-3 border-b border-[var(--hairline)] px-3 py-2 last:border-b-0"
          >
            <div className="flex min-w-0 items-center gap-2">
              <Flag region={client.region ?? ""} size={13} />
              <span
                className="truncate text-[13px] text-[var(--text-primary)]"
                title={client.name}
              >
                {client.name}
              </span>
              <span
                className="shrink-0 text-[11px] text-[var(--text-tertiary)]"
                title="该节点当前剩余价值（按账单周期折算，不含溢价）"
              >
                {referenceLabel}
              </span>
              {entry && (
                <span
                  className="shrink-0 text-[11px] font-medium"
                  style={{
                    color:
                      entry.amount > 0
                        ? "var(--status-error)"
                        : entry.amount < 0
                          ? "var(--status-success)"
                          : "var(--text-tertiary)",
                  }}
                  title={
                    entry.paidCny != null
                      ? "溢价 = 收购价 − 收购日剩余价值；该折算基准已经固化"
                      : "旧格式：直接记录的溢价，填写收购价后自动升级"
                  }
                >
                  溢价 {formatSignedCny(entry.amount)}
                </span>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <input
                type="number"
                inputMode="decimal"
                step="any"
                min="0"
                value={entry?.paidCny ?? ""}
                onChange={(event) => {
                  // 键入 `-`/`e` 等非法中间态时 value 为空串,不能误当"留空即清除"删掉记录。
                  if (event.target.validity.badInput) return;
                  onPatchPaid(client.uuid, event.target.value);
                }}
                placeholder="收购价"
                disabled={!canCompute}
                aria-label={`${client.name} 的收购价`}
                title={
                  canCompute
                    ? "实际收购价（人民币），留空即清除记录"
                    : "该节点已忽略或汇率缺失，无法折算剩余价值"
                }
                className="surface-inset w-24 px-2 py-1 text-right text-[13px] outline-none disabled:opacity-45"
              />
              <input
                type="date"
                max={acquiredAtMax}
                value={entry?.acquiredAt ?? ""}
                onChange={(event) => onPatchAcquiredAt(client.uuid, event.target.value)}
                // 与收购价同门槛:汇率/基准未就绪时 patchPremiumAcquiredAt 无法回算,
                // 放开输入只会被静默丢弃(受控值弹回旧日期)。
                disabled={!entry || !canCompute}
                aria-label={`${client.name} 的收购日期`}
                title={
                  canCompute
                    ? "收购日期：修改后会按当前价格、周期、到期日和汇率回算该日剩余价值，重新计算并固化溢价"
                    : "该节点已忽略或汇率缺失，无法折算剩余价值"
                }
                className="surface-inset w-[8.75rem] px-2 py-1 text-[12px] outline-none disabled:opacity-45"
              />
            </div>
          </div>
        );
      })}
    </div>
  );
});

// 弹窗开关留在这个小组件内，打开面板时不再让整个设置页跟着重渲染。
const MultiPingNodeConfigControl = memo(function MultiPingNodeConfigControl({
  clients,
  tasks,
  globalTaskIds,
  nodeTaskIds,
  configuredNodeCount,
  fakePingForUnbound,
  disabled,
  saving,
  saveDisabled,
  saveError,
  onChange,
  onSave,
}: {
  clients: AdminClient[];
  tasks: PingTask[];
  globalTaskIds: number[];
  nodeTaskIds: HomepageMultiPingNodeTaskIds;
  configuredNodeCount: number;
  fakePingForUnbound: boolean;
  disabled: boolean;
  saving: boolean;
  saveDisabled: boolean;
  saveError: string | null;
  onChange: (next: HomepageMultiPingNodeTaskIds) => void;
  onSave: () => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  return (
    <>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--hairline)] pt-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[12px] font-medium text-[var(--text-primary)]">
            <SlidersHorizontal size={14} />
            按服务器覆盖
          </div>
          <p className="mt-1 text-[11px] text-[var(--text-tertiary)]">
            已单独配置 {configuredNodeCount} / {clients.length} 台服务器
          </p>
        </div>
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen(true)}
          className="theme-manage-button is-compact"
        >
          <SlidersHorizontal size={13} />
          配置服务器探测点
        </button>
      </div>

      {open && (
        <MultiPingNodeConfigPanel
          open
          clients={clients}
          tasks={tasks}
          globalTaskIds={globalTaskIds}
          nodeTaskIds={nodeTaskIds}
          fakePingForUnbound={fakePingForUnbound}
          saving={saving}
          saveDisabled={saveDisabled}
          saveError={saveError}
          onChange={onChange}
          onClose={close}
          onSave={onSave}
        />
      )}
    </>
  );
});

const MerchantLinkConfigControl = memo(function MerchantLinkConfigControl({
  clients,
  links,
  configuredNodeCount,
  enabled,
  disabled,
  saving,
  saveDisabled,
  saveError,
  onChange,
  onSave,
}: {
  clients: AdminClient[];
  links: NodeMerchantLinks;
  configuredNodeCount: number;
  enabled: boolean;
  disabled: boolean;
  saving: boolean;
  saveDisabled: boolean;
  saveError: string | null;
  onChange: (next: NodeMerchantLinks) => void;
  onSave: () => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  return (
    <>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--hairline)] pt-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[12px] font-medium text-[var(--text-primary)]">
            <Store size={14} />
            按服务器配置商家官网
          </div>
          <p className="mt-1 text-[11px] text-[var(--text-tertiary)]">
            {configuredNodeCount} / {clients.length} 台已配置；卡片入口当前{enabled ? "显示" : "隐藏"}
          </p>
        </div>
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen(true)}
          className="theme-manage-button is-compact"
        >
          <Store size={13} />
          配置商家链接
        </button>
      </div>

      {open && (
        <MerchantLinkConfigPanel
          open
          clients={clients}
          links={links}
          saving={saving}
          saveDisabled={saveDisabled}
          saveError={saveError}
          onChange={onChange}
          onClose={close}
          onSave={onSave}
        />
      )}
    </>
  );
});

const TrafficResetConfigControl = memo(function TrafficResetConfigControl({
  clients,
  days,
  configuredNodeCount,
  now,
  disabled,
  saving,
  saveDisabled,
  saveError,
  onChange,
  onSave,
}: {
  clients: AdminClient[];
  days: Record<string, number>;
  configuredNodeCount: number;
  now: number;
  disabled: boolean;
  saving: boolean;
  saveDisabled: boolean;
  saveError: string | null;
  onChange: (next: Record<string, number>) => void;
  onSave: () => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-[13px] text-[var(--text-secondary)]">
          已自定义 {configuredNodeCount} 台，其余跟随账单日
        </span>
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen(true)}
          className="theme-manage-button"
        >
          <SlidersHorizontal size={14} />配置重置日
        </button>
      </div>
      {open && (
        <TrafficResetConfigPanel
          clients={clients}
          days={days}
          now={now}
          saving={saving}
          saveDisabled={saveDisabled}
          saveError={saveError}
          onChange={onChange}
          onClose={close}
          onSave={onSave}
        />
      )}
    </>
  );
});

export function ThemeManage() {
  const isMobileViewport = useMediaQuery(MOBILE_VIEWPORT_QUERY, true);
  const now = useHourlyClock();
  const adminEntryPath = useAdminEntryPath();
  const adminPingHref = adminEntryPath ? `${adminEntryPath}/ping` : undefined;
  const {
    data: config,
    isLoading: configLoading,
    error: configError,
    refetch: refetchConfig,
  } = usePublicConfig();
  const sourceThemeSettings = useMemo(
    () => normalizeThemeSettings(config?.theme_settings),
    [config?.theme_settings],
  );
  const sourceManagedSettings = useMemo(
    () => pickManagedThemeSettings(sourceThemeSettings),
    [sourceThemeSettings],
  );
  // 按内容判断服务端设置是否真的变化，避免同内容 refetch 重置草稿。
  const sourceSignature = useMemo(
    () => JSON.stringify(sourceManagedSettings),
    [sourceManagedSettings],
  );
  // 全部托管设置收敛为单个草稿对象，并独立记录草稿最后一次初始化/回灌时的基线，
  // 避免 public 查询后台刷新后，把其他端的新增改动误算为本页的“反改”而覆盖掉。
  const [seededThemeSettings, setSeededThemeSettings] = useState<ResolvedThemeSettings>(() =>
    config ? sourceThemeSettings : DEFAULT_THEME_SETTINGS,
  );
  const [draft, setDraft] = useState<ThemeDraft>(() =>
    draftFromSettings(config ? sourceThemeSettings : DEFAULT_THEME_SETTINGS),
  );
  const lastSeededSignatureRef = useRef<string | null>(config ? sourceSignature : null);
  const seededManagedSettings = useMemo(
    () => pickManagedThemeSettings(seededThemeSettings),
    [seededThemeSettings],
  );
  const seededSignature = useMemo(
    () => JSON.stringify(seededManagedSettings),
    [seededManagedSettings],
  );
  const [expandedTaskId, setExpandedTaskId] = useState<number | null>(null);
  const [taskSearch, setTaskSearch] = useState("");
  const [nodeSearch, setNodeSearch] = useState("");
  const [premiumSearch, setPremiumSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accessRevoked, setAccessRevoked] = useState(false);
  const savingDraftRef = useRef<ThemeDraft | null>(null);
  const editVersionRef = useRef(0);
  const draftRef = useRef(draft);
  useLayoutEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  // 同值失焦不计作新编辑；同步更新引用也能识别同一批次内连续修改同一字段。
  const patch = useCallback(
    <K extends keyof ThemeDraft>(key: K, value: ThemeDraft[K]) => {
      if (Object.is(draftRef.current[key], value)) return;
      draftRef.current = { ...draftRef.current, [key]: value };
      editVersionRef.current += 1;
      setDraft((prev) => (Object.is(prev[key], value) ? prev : { ...prev, [key]: value }));
    },
    [],
  );
  const patchNodeMerchantLinks = useCallback(
    (next: NodeMerchantLinks) => patch("nodeMerchantLinks", next),
    [patch],
  );
  const patchTrafficResetDays = useCallback(
    (next: Record<string, number>) => patch("trafficResetDays", next),
    [patch],
  );
  // 绑定关系的三个入口(勾选/全选/清空)都是基于前值的函数式更新,单独收口。
  const patchBindings = useCallback(
    (updater: (prev: HomepagePingTaskBindings) => HomepagePingTaskBindings) => {
      editVersionRef.current += 1;
      setDraft((prev) => ({
        ...prev,
        homepagePingBindings: updater(prev.homepagePingBindings),
      }));
    },
    [],
  );
  const toggleTaskExpanded = useCallback((taskId: number) => {
    setExpandedTaskId((current) => (current === taskId ? null : taskId));
    setNodeSearch("");
  }, []);
  const patchMultiPingTask = useCallback((slot: number, rawValue: string) => {
    editVersionRef.current += 1;
    setDraft((prev) => {
      const nextSlots = patchMultiPingTaskSlots(prev.homepageMultiPingTaskSlots, slot, rawValue);
      return nextSlots.every((id, index) => id === prev.homepageMultiPingTaskSlots[index])
        ? prev
        : { ...prev, homepageMultiPingTaskSlots: nextSlots };
    });
  }, []);
  const patchNodeMultiPingTaskIds = useCallback(
    (next: HomepageMultiPingNodeTaskIds) => {
      editVersionRef.current += 1;
      const normalized = normalizeHomepageMultiPingNodeTaskIds(next);
      setDraft((prev) =>
        JSON.stringify(prev.homepageMultiPingNodeTaskIds) === JSON.stringify(normalized)
          ? prev
          : { ...prev, homepageMultiPingNodeTaskIds: normalized },
      );
    },
    [],
  );

  const {
    data: pingTasks,
    isLoading: tasksLoading,
    error: tasksError,
  } = useQuery({
    queryKey: ["admin", "ping-tasks"],
    queryFn: ({ signal }) => getAdminPingTasks({ signal }),
    staleTime: 30_000,
    retry: false,
  });
  const {
    data: adminClients,
    isLoading: clientsLoading,
    error: clientsError,
  } = useQuery({
    queryKey: ["admin", "clients"],
    queryFn: ({ signal }) => getAdminClients({ signal }),
    staleTime: 30_000,
    retry: false,
  });

  // 把服务端设置灌入草稿与差异基线的唯一出口,reseed effect、保存后和重置按钮都走它。
  const seedDrafts = useCallback((next: ResolvedThemeSettings) => {
    lastSeededSignatureRef.current = JSON.stringify(pickManagedThemeSettings(next));
    setSeededThemeSettings(next);
    setDraft(draftFromSettings(next));
  }, []);

  const sortedTasks = useMemo(() => sortTasks(pingTasks ?? []), [pingTasks]);
  const sortedClients = useMemo(() => sortClients(adminClients ?? []), [adminClients]);
  const clientsById = useMemo(
    () => new Map(sortedClients.map((client) => [client.uuid, client])),
    [sortedClients],
  );

  const filteredTasks = useMemo(() => {
    const keyword = taskSearch.trim().toLowerCase();
    if (!keyword) return sortedTasks;
    return sortedTasks.filter((task) => {
      return (
        task.name.toLowerCase().includes(keyword) ||
        String(task.id).includes(keyword) ||
        task.type.toLowerCase().includes(keyword) ||
        task.target.toLowerCase().includes(keyword)
      );
    });
  }, [sortedTasks, taskSearch]);

  const visibleClients = useMemo(
    () => filterClients(sortedClients, nodeSearch),
    [nodeSearch, sortedClients],
  );
  const filteredPremiumClients = useMemo(
    () => filterClients(sortedClients, premiumSearch),
    [premiumSearch, sortedClients],
  );

  // 溢价表格里"当前剩余价值"仅供参考,用已保存的汇率源/忽略名单算(不用草稿里还没保存的
  // 编辑),口径与资产统计页完全一致(同一个 calculateCostSummary),但不叠加溢价本身。
  // 刻意用一次性 getNodes 查询而不是 useAllNodeMeta():后者会启动全局节点 store 的实时
  // 状态轮询(wsStore),设置页只需要静态 meta,不该为一列参考值挂一个常驻轮询。
  const { data: allMeta = [] } = useQuery({
    queryKey: ["theme-manage", "node-meta"],
    queryFn: ({ signal }) => getNodes({ signal }),
    staleTime: 60_000,
    retry: 1,
  });
  const premiumRateQuery = useQuery({
    queryKey: ["cost-rates", sourceThemeSettings.costRateApiUrl],
    queryFn: ({ signal }) => getExchangeRates(sourceThemeSettings.costRateApiUrl, { signal }),
    staleTime: 60 * 60 * 1000,
    enabled: allMeta.length > 0,
    retry: 1,
  });
  const premiumDetailByUuid = useMemo(() => {
    const map = new Map<string, ReturnType<typeof calculateCostSummary>["details"][number]>();
    if (!premiumRateQuery.data) return map;
    const summary = calculateCostSummary(
      allMeta,
      sourceThemeSettings.costIgnoredNodes,
      premiumRateQuery.data.rates,
      undefined,
      now,
    );
    for (const detail of summary.details) map.set(detail.uuid, detail);
    return map;
  }, [allMeta, now, sourceThemeSettings.costIgnoredNodes, premiumRateQuery.data]);

  // 使用当前价格、周期、到期日和汇率回算指定收购日的剩余价值；结果只在用户编辑
  // 收购价/日期时用于固化溢价，不会因后续续费或汇率变化自动改写。
  const premiumBasisAt = useCallback(
    (uuid: string, acquiredAt?: string): number | null => {
      if (!premiumRateQuery.data) return null;
      if (!acquiredAt || acquiredAt === localDateInputMax()) {
        const detail = premiumDetailByUuid.get(uuid);
        if (!detail) return null;
        if (detail.note === "免费") return 0;
        return detail.counted ? detail.remainingCny : null;
      }
      return calculateCostPremiumBasisAt(
        allMeta,
        sourceThemeSettings.costIgnoredNodes,
        premiumRateQuery.data.rates,
        uuid,
        acquiredAt,
        now,
      );
    },
    [
      allMeta,
      now,
      premiumDetailByUuid,
      sourceThemeSettings.costIgnoredNodes,
      premiumRateQuery.data,
    ],
  );

  const premiumConfiguredCount = useMemo(
    () => sortedClients.filter((client) => Boolean(draft.costPremiums[client.uuid])).length,
    [draft.costPremiums, sortedClients],
  );

  // 收购价清空即删条目；溢价按收购日的回算剩余价值算出并固化，不随后续续费/汇率漂移。
  const patchPremiumPaid = useCallback(
    (uuid: string, rawValue: string) => {
      editVersionRef.current += 1;
      setDraft((prev) => {
        const next = { ...prev.costPremiums };
        if (rawValue.trim() === "") {
          if (!(uuid in next)) return prev;
          delete next[uuid];
          return { ...prev, costPremiums: next };
        }
        const paid = Number(rawValue);
        if (!Number.isFinite(paid) || paid < 0) return prev;
        const current = prev.costPremiums[uuid];
        if (current && Object.is(current.paidCny, paid)) return prev;
        const acquiredAt = current?.acquiredAt ?? localDateInputMax();
        const storedBasis =
          current?.paidCny != null ? current.paidCny - current.amount : Number.NaN;
        const basis = Number.isFinite(storedBasis)
          ? storedBasis
          : premiumBasisAt(uuid, acquiredAt);
        if (basis == null) return prev;
        next[uuid] = buildPremiumEntry(
          calculateCostPremiumAmount(paid, basis, current),
          paid,
          acquiredAt,
        );
        return { ...prev, costPremiums: next };
      });
    },
    [premiumBasisAt],
  );

  // 主动修改收购日期时重新回算该日剩余价值并固化新溢价；保存后仍保持固定。
  const patchPremiumAcquiredAt = useCallback(
    (uuid: string, rawValue: string) => {
      editVersionRef.current += 1;
      setDraft((prev) => {
        const current = prev.costPremiums[uuid];
        if (!current) return prev;
        const acquiredAt = rawValue.trim() || undefined;
        if (current.acquiredAt === acquiredAt) return prev;
        let amount = current.amount;
        if (acquiredAt && current.paidCny != null) {
          const basis = premiumBasisAt(uuid, acquiredAt);
          if (basis == null) return prev;
          amount = calculateCostPremiumAmount(current.paidCny, basis);
        }
        const next = { ...prev.costPremiums };
        next[uuid] = buildPremiumEntry(amount, current.paidCny, acquiredAt);
        return { ...prev, costPremiums: next };
      });
    },
    [premiumBasisAt],
  );

  const draftHiddenNodes = useMemo(
    () => normalizeNodeIdentityList(draft.hiddenNodesText),
    [draft.hiddenNodesText],
  );
  const draftMultiPingTaskIds = useMemo(
    () =>
      normalizeHomepageMultiPingTaskIds(
        draft.homepageMultiPingTaskSlots.filter((id): id is number => id != null),
      ),
    [draft.homepageMultiPingTaskSlots],
  );
  const draftCostRateApiUrlInvalid =
    draft.costRateApiUrl.trim() !== "" && !isCostRateApiUrlValid(draft.costRateApiUrl.trim());
  const draftMerchantLinksInvalid = hasInvalidMerchantLinks(draft.nodeMerchantLinks);
  const draftBackgroundImageInvalid = !isBackgroundUrlValid(draft.backgroundImage);
  const draftBackgroundImageMobileInvalid = !isBackgroundUrlValid(draft.backgroundImageMobile);
  const draftUrlValidationError = draftMerchantLinksInvalid
    ? "商家官网或图标地址格式有误，请在商家跳转设置中修正后保存。"
    : draftBackgroundImageInvalid || draftBackgroundImageMobileInvalid
      ? "背景图片地址格式有误，请修正后保存。"
      : null;
  const draftMultiPingInvalid =
    draft.enableHomepageMultiPing &&
    (draft.homepageMultiPingTaskSlots.some((id) => id == null) ||
      draftMultiPingTaskIds.length !== HOMEPAGE_MULTI_PING_TASK_COUNT);

  // 由当前草稿拼出的设置 payload,保存请求和 dirty 判断都用它。草稿字段与设置同名,这里只做
  // 「编辑态 → 存储态」的换形与归一化;文本域与槽位字段解构出来换回存储字段,其余原样透传。
  const normalizedBackgroundVideo = normalizeBackgroundVideoUrl(draft.backgroundVideo);
  const normalizedBackgroundVideoDark = normalizeBackgroundVideoUrl(draft.backgroundVideoDark);
  const backgroundVideoLightMalformed =
    draft.backgroundVideo.trim() !== "" && !normalizedBackgroundVideo;
  const backgroundVideoDarkInvalid =
    draft.backgroundVideoDark.trim() !== "" && !normalizedBackgroundVideoDark;
  const backgroundVideoLightInvalid =
    draft.backgroundMediaType === "video" && !normalizedBackgroundVideo;
  const videoInputInvalid =
    draft.backgroundMediaType === "video" &&
    (!normalizedBackgroundVideo || backgroundVideoDarkInvalid);

  const draftThemeSettings = useMemo<ThemeSettings>(() => {
    const {
      ratingLabels,
      hiddenNodesText,
      costIgnoredText,
      surfaceOpacityText,
      homeHeaderVisibleSecondsText,
      homepageMultiPingTaskSlots,
      ...rest
    } = draft;
    void homepageMultiPingTaskSlots;
    return {
      ...rest,
      homepagePingBindings: pruneBindings(rest.homepagePingBindings),
      homepageMultiPingTaskIds: draftMultiPingTaskIds,
      homepageMultiPingNodeTaskIds: normalizeHomepageMultiPingNodeTaskIds(
        rest.homepageMultiPingNodeTaskIds,
      ),
      nodeMerchantLinks: normalizeNodeMerchantLinks(rest.nodeMerchantLinks),
      trafficRatingLabels: ratingLabels.traffic,
      bandwidthRatingLabels: ratingLabels.bandwidth,
      assetRatingLabels: ratingLabels.asset,
      hiddenNodes: normalizeNodeIdentityList(hiddenNodesText),
      costIgnoredNodes: normalizeCostIgnoredNodes(costIgnoredText),
      costPremiums: normalizeCostPremiums(rest.costPremiums),
      costRateApiUrl: normalizeCostRateApiUrl(rest.costRateApiUrl),
      backgroundImage: normalizeBackgroundUrl(rest.backgroundImage),
      backgroundImageMobile: normalizeBackgroundUrl(rest.backgroundImageMobile),
      backgroundVideo: backgroundVideoLightMalformed
        ? seededThemeSettings.backgroundVideo
        : normalizedBackgroundVideo || DEFAULT_BACKGROUND_VIDEO_URL,
      backgroundVideoDark: backgroundVideoDarkInvalid
        ? seededThemeSettings.backgroundVideoDark
        : normalizedBackgroundVideoDark,
      backgroundAlignment: normalizeBackgroundAlignment(rest.backgroundAlignment),
      surfaceOpacity:
        surfaceOpacityText.trim() === ""
          ? seededThemeSettings.surfaceOpacity
          : normalizeSurfaceOpacity(surfaceOpacityText),
      homeHeaderVisibleSeconds:
        homeHeaderVisibleSecondsText.trim() === ""
          ? seededThemeSettings.homeHeaderVisibleSeconds
          : normalizeHomeHeaderVisibleSeconds(homeHeaderVisibleSecondsText),
    };
  }, [
    backgroundVideoDarkInvalid,
    backgroundVideoLightMalformed,
    draft,
    draftMultiPingTaskIds,
    normalizedBackgroundVideo,
    normalizedBackgroundVideoDark,
    seededThemeSettings.backgroundVideo,
    seededThemeSettings.backgroundVideoDark,
    seededThemeSettings.homeHeaderVisibleSeconds,
    seededThemeSettings.surfaceOpacity,
  ]);

  // 单次归一化得到受管设置与签名，避免再套一层 normalizeThemeSettings 双重归一化。
  const draftManagedSettings = useMemo(
    () =>
      pickManagedThemeSettings(
        normalizeThemeSettings(draftThemeSettings as ThemeSettings & Record<string, unknown>),
      ),
    [draftThemeSettings],
  );
  const draftSignature = useMemo(
    () => JSON.stringify(draftManagedSettings),
    [draftManagedSettings],
  );
  // 脏状态基于草稿最后一次初始化/回灌时的基线判断：后台 public 刷新不会把未编辑页误标为 dirty，
  // 也不会污染保存时的差异基线。
  const costRateApiUrlDirty =
    draft.costRateApiUrl.trim() !== seededThemeSettings.costRateApiUrl;
  const isDirty =
    draftSignature !== seededSignature ||
    costRateApiUrlDirty ||
    Boolean(draftUrlValidationError) ||
    videoInputInvalid;
  const draftSaveInvalid =
    draftCostRateApiUrlInvalid || Boolean(draftUrlValidationError) || videoInputInvalid || draftMultiPingInvalid;
  const saveDisabled = !isDirty || draftSaveInvalid;

  const adminAccessDenied =
    (tasksError instanceof ApiRequestError &&
      (tasksError.status === 401 || tasksError.status === 403)) ||
    (clientsError instanceof ApiRequestError &&
      (clientsError.status === 401 || clientsError.status === 403));

  useEffect(() => {
    if (accessRevoked || adminAccessDenied) {
      void queryClient.invalidateQueries({ queryKey: ["me"] });
    }
  }, [accessRevoked, adminAccessDenied]);

  // 用户重新编辑后清掉「已保存」提示,避免过期的成功提示和 dirty 表单并存。
  useEffect(() => {
    if (isDirty) setMessage(null);
  }, [isDirty]);

  // 服务端设置真正变化时灌入草稿。首次灌入之后,只要表单有未保存编辑(含保存中)就跳过,
  // 避免 refetch / 其他端保存的回流静默覆盖用户草稿或改变差异基线。
  useEffect(() => {
    if (!config) return;
    if (!shouldReseedThemeDraft(lastSeededSignatureRef.current, sourceSignature, isDirty)) {
      return;
    }
    seedDrafts(sourceThemeSettings);
  }, [config, isDirty, sourceSignature, sourceThemeSettings, seedDrafts]);

  const assignedNodeCount = useMemo(
    () =>
      Object.values(draft.homepagePingBindings).reduce(
        (total, clients) => total + clients.length,
        0,
      ),
    [draft.homepagePingBindings],
  );
  const multiPingConfiguredNodeCount = useMemo(
    () =>
      sortedClients.filter((client) => draft.homepageMultiPingNodeTaskIds[client.uuid])
        .length,
    [draft.homepageMultiPingNodeTaskIds, sortedClients],
  );
  const merchantConfiguredNodeCount = useMemo(
    () =>
      sortedClients.filter((client) =>
        Boolean(sanitizeMerchantUrl(draft.nodeMerchantLinks[client.uuid]?.url)),
      ).length,
    [draft.nodeMerchantLinks, sortedClients],
  );
  const trafficResetConfiguredNodeCount = useMemo(
    () => sortedClients.filter((client) => draft.trafficResetDays[client.uuid] != null).length,
    [draft.trafficResetDays, sortedClients],
  );

  // 每个 client 归属哪个 task 的反查,只在绑定草稿变化时重建。与「全选可用」reducer
  // 共用 invertBindings() 避免推导漂移,并把可选节点过滤保持在 O(tasks × clients),
  // 而不是每个 client 都重扫一遍 bindings。
  const assignedTaskByClientUuid = useMemo(
    () => invertBindings(draft.homepagePingBindings),
    [draft.homepagePingBindings],
  );

  const saveContextRef = useRef({
    config,
    draft,
    draftSaveInvalid,
    seededManagedSettings,
    draftManagedSettings,
  });
  useLayoutEffect(() => {
    saveContextRef.current = {
      config,
      draft,
      draftSaveInvalid,
      seededManagedSettings,
      draftManagedSettings,
    };
  }, [config, draft, draftManagedSettings, draftSaveInvalid, seededManagedSettings]);

  const handleSave = useCallback(async (): Promise<boolean> => {
    const current = saveContextRef.current;
    if (
      !current.config?.theme ||
      savingDraftRef.current ||
      current.draftSaveInvalid
    ) {
      return false;
    }
    const submittedEditVersion = editVersionRef.current;
    savingDraftRef.current = current.draft;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      // 保存前先拉取远端最新配置，并基于草稿最后一次初始化/回灌时的基线计算差异，
      // 仅覆盖本页实际修改过的托管字段，避免后台刷新后覆盖其他页签刚写入的最新字段。
      const latestPublic =
        (await getPublic().catch(() => null)) ??
        queryClient.getQueryData<PublicConfig>(["public"]) ??
        current.config;
      const nextSettings = mergeManagedThemeSettingsDiff(
        latestPublic.theme_settings,
        current.seededManagedSettings,
        current.draftManagedSettings,
      );
      await saveThemeSettings(latestPublic.theme || current.config.theme, nextSettings);
      queryClient.setQueryData<PublicConfig>(["public"], (prev) =>
        prev
          ? { ...prev, theme_settings: nextSettings }
          : { ...latestPublic, theme_settings: nextSettings },
      );
      const savedResolved = normalizeThemeSettings(nextSettings);
      if (editVersionRef.current === submittedEditVersion) {
        // 立刻按归一化后的最新设置回灌草稿与基线（例如清空 costRateApiUrl 保存后恢复为默认 URL 并清除 dirty）。
        seedDrafts(savedResolved);
        setMessage("主题设置已保存");
        void queryClient.invalidateQueries({ queryKey: ["public"] });
        return true;
      }
      // 保存请求在途期间用户又修改了表单：必须把基线推进到刚保存成功的快照，同时保留提交后的新编辑
      // （例如关闭后保存、完成前又改回开启），避免草稿与旧基线碰巧一致被误判非 dirty 而被 public 回灌覆盖。
      const savedDraft = draftFromSettings(savedResolved);
      const submittedDraft = savingDraftRef.current;
      lastSeededSignatureRef.current = JSON.stringify(pickManagedThemeSettings(savedResolved));
      setSeededThemeSettings(savedResolved);
      if (submittedDraft) {
        setDraft((latestDraft) =>
          rebaseThemeDraftAfterSave(savedDraft, submittedDraft, latestDraft),
        );
      }
      void queryClient.invalidateQueries({ queryKey: ["public"] });
      return false;
    } catch (saveError) {
      if (
        saveError instanceof ApiRequestError &&
        (saveError.status === 401 || saveError.status === 403)
      ) {
        void queryClient.invalidateQueries({ queryKey: ["me"] });
        setAccessRevoked(true);
        return false;
      }
      setError(saveError instanceof Error ? saveError.message : "保存失败");
      return false;
    } finally {
      savingDraftRef.current = null;
      setSaving(false);
    }
  }, [seedDrafts]);

  const handleReset = () => {
    seedDrafts(sourceThemeSettings);
    setMessage(null);
    setError(null);
  };

  if (configLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner size={24} />
      </div>
    );
  }

  if (!config) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
        <div role="alert" className="space-y-2">
          <div className="text-[15px] font-semibold text-[var(--text-primary)]">
            无法读取主题配置
          </div>
          <p className="max-w-[32rem] text-[13px] text-[var(--text-secondary)]">
            {configError instanceof Error ? configError.message : "请稍后重试。"}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => void refetchConfig()}
            className="control-button px-4 py-2 text-[13px] font-medium"
          >
            重试
          </button>
          <Link to="/" className="control-button px-4 py-2 text-[13px] font-medium">
            返回首页
          </Link>
        </div>
      </div>
    );
  }

  if (accessRevoked || adminAccessDenied) {
    return <Navigate to="/" replace />;
  }

  const adminError =
    (tasksError instanceof Error ? tasksError.message : null) ||
    (clientsError instanceof Error ? clientsError.message : null);
  const noTasksYet = !tasksLoading && !clientsLoading && sortedTasks.length === 0;
  const noFilteredTaskMatch = !tasksLoading && !clientsLoading && !noTasksYet && filteredTasks.length === 0;
  const setRatingLabelDraft = (kind: OverviewRatingKind, value: string) => {
    editVersionRef.current += 1;
    setDraft((prev) => ({
      ...prev,
      ratingLabels: { ...prev.ratingLabels, [kind]: value },
    }));
  };
  const draftBgAlignment = parseBackgroundAlignment(draft.backgroundAlignment);
  const setBgSize = (size: BackgroundSize) =>
    patch("backgroundAlignment", `${size},${draftBgAlignment.position}`);
  const setBgPosition = (position: BackgroundPosition) =>
    patch("backgroundAlignment", `${draftBgAlignment.size},${position}`);
  const hasBackgroundMedia =
    draft.enableBackgroundImage &&
    Boolean(
        normalizeBackgroundUrl(draft.backgroundImage) ||
        normalizeBackgroundUrl(draft.backgroundImageMobile) ||
        draft.backgroundMediaType === "video" &&
        (draft.backgroundVideo || draft.backgroundVideoDark),
    );
  const acquiredAtMax = localDateInputMax();

  return (
    <div className="theme-manage flex flex-col gap-5 py-2">
      <header className="theme-masthead">
        <div className="theme-masthead-topline">
          <Link to="/" className="instance-page-back">
            <ArrowLeft size={14} />
            返回首页
          </Link>
          <div className="theme-manage-toolbar-actions">
            <button
              type="button"
              onClick={handleReset}
              disabled={!isDirty || saving}
              className="theme-manage-button"
            >
              <RefreshCw size={14} />
              <span>重置</span>
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saveDisabled || saving}
              className="theme-manage-button is-primary"
            >
              {saving ? <Spinner size={14} /> : <Save size={14} />}
              <span>{saving ? "保存中" : "保存设置"}</span>
            </button>
          </div>
        </div>
        <div className="theme-masthead-main">
          <div className="theme-masthead-headings">
            <span className="theme-masthead-kicker">LUMINAPLUS · 主题控制台</span>
            <h1 className="theme-masthead-title">主题设置</h1>
            <p className="theme-masthead-desc">
              集中调整 LuminaPlus 的展示偏好与首页延迟绑定；保存后立即应用到当前站点。
            </p>
          </div>
          <dl className="theme-masthead-meta">
            <div>
              <dt>主题</dt>
              <dd>{config?.theme || "Komari-Theme-LuminaPlus"}</dd>
            </div>
            <div>
              <dt>已绑定 Ping</dt>
              <dd>
                {draft.enableHomepageMultiPing
                  ? `三网覆盖 ${multiPingConfiguredNodeCount} 台`
                  : `${assignedNodeCount} / ${sortedClients.length}`}
              </dd>
            </div>
          </dl>
        </div>
      </header>

      {(message || error || draftUrlValidationError || adminError) && (
        <div className="flex flex-col gap-3">
          {message && (
            <div
              role="status"
              aria-live="polite"
              className="rounded-[12px] border border-[color-mix(in_srgb,var(--status-online)_28%,transparent)] bg-[color-mix(in_srgb,var(--status-online)_11%,var(--surface))] px-4 py-3 text-[13px] text-[var(--status-online)]"
            >
              {message}
            </div>
          )}
          {(error || draftUrlValidationError) && (
            <div
              role="alert"
              className="rounded-[12px] border border-[color-mix(in_srgb,var(--status-offline)_28%,transparent)] bg-[color-mix(in_srgb,var(--status-offline)_11%,var(--surface))] px-4 py-3 text-[13px] text-[var(--status-offline)]"
            >
              {error || draftUrlValidationError}
            </div>
          )}
          {adminError && (
            <div
              role="alert"
              className="rounded-[12px] border border-[color-mix(in_srgb,var(--status-offline)_28%,transparent)] bg-[color-mix(in_srgb,var(--status-offline)_11%,var(--surface))] px-4 py-3 text-[13px] text-[var(--status-offline)]"
            >
              无法读取后台 Ping 任务或节点列表: {adminError}
            </div>
          )}
        </div>
      )}

      <InstancePanel
        kicker={<><span className="instance-panel-kicker-num">01</span>外观</>}
        title="默认外观"
        description="为首次访问或尚未手动切换外观的用户设置默认显示模式；后续仍可在首页右上角按需切换。"
        aside={<LayoutTemplate size={16} />}
      >
        <div className="instance-segmented is-scrollable">
          {APPEARANCE_OPTIONS.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              data-active={draft.defaultAppearance === value ? "true" : "false"}
              aria-pressed={draft.defaultAppearance === value}
              onClick={() => patch("defaultAppearance", value)}
              className="inline-flex items-center justify-center gap-2"
            >
              <Icon size={14} />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </InstancePanel>

      <InstancePanel
        kicker={<><span className="instance-panel-kicker-num">02</span>视图</>}
        title="默认卡片视图"
        description="分别设置桌面端与移动端的默认卡片尺寸；首页右上角按钮只临时切换当前设备的显示。"
        aside={<LayoutGrid size={16} />}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div className="surface-inset flex min-w-0 flex-col gap-3 px-4 py-4">
            <div>
              <div className="text-[13px] font-semibold text-[var(--text-primary)]">
                桌面端默认
              </div>
              <div className="mt-1 text-[11px] text-[var(--text-tertiary)]">
                适用于宽度大于 720px 的浏览器窗口。
              </div>
            </div>
            <div className="instance-segmented is-scrollable">
              {NODE_VIEW_MODE_OPTIONS.map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  data-active={draft.desktopNodeViewMode === value ? "true" : "false"}
                  aria-pressed={draft.desktopNodeViewMode === value}
                  onClick={() => patch("desktopNodeViewMode", value)}
                  className="inline-flex items-center justify-center gap-2"
                >
                  <Icon size={14} />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="surface-inset flex min-w-0 flex-col gap-3 px-4 py-4">
            <div>
              <div className="text-[13px] font-semibold text-[var(--text-primary)]">
                移动端默认
              </div>
              <div className="mt-1 text-[11px] text-[var(--text-tertiary)]">
                适用于宽度小于等于 720px 的手机或窄屏窗口。
              </div>
            </div>
            <div className="instance-segmented is-scrollable">
              {MOBILE_VIEW_MODE_OPTIONS.map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  data-active={draft.mobileNodeViewMode === value ? "true" : "false"}
                  aria-pressed={draft.mobileNodeViewMode === value}
                  onClick={() => patch("mobileNodeViewMode", value)}
                  className="inline-flex items-center justify-center gap-2"
                >
                  <Icon size={14} />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </InstancePanel>

      <InstancePanel
        kicker={<><span className="instance-panel-kicker-num">03</span>背景</>}
        title="背景与透明度"
        description={isMobileViewport
          ? "为站点设置背景图或桌面视频，并调节卡片不透明度。"
          : "为站点设置背景图、桌面视频或首页地图，并调节卡片不透明度。"}
        aside={<Wallpaper size={16} />}
      >
        <div className="flex flex-col gap-4">
          <ToggleRow
            field="enableBackgroundImage"
            title="启用自定义背景"
            desc={isMobileViewport
              ? "关闭后不加载背景图或视频，下方 URL 配置会保留。"
              : "关闭后不加载背景图或视频，下方 URL 配置会保留；地图背景由独立开关控制。"}
            checked={draft.enableBackgroundImage}
            onPatch={patch}
          />
          {!isMobileViewport && (
            <ToggleRow
              field="enableMapBackground"
              title="启用桌面地图背景"
              desc="默认关闭，仅桌面端生效。大幅节点地图铺在首页内容下方，总览和实例卡片覆盖其上。总览独立排列为两行，每行与一张实例卡等宽，可在下方自行调整卡片不透明度。"
              checked={draft.enableMapBackground}
              onPatch={patch}
            />
          )}

          <div className="surface-inset flex flex-col gap-3 px-4 py-4">
            <ToggleRow
              field="enableAmbientEffect"
              title="启用背景动效"
              desc="默认关闭；开启后在页面上轻量渲染所选氛围效果，不影响点击和滚动。"
              checked={draft.enableAmbientEffect}
              onPatch={patch}
            />
            <label className="flex min-w-0 flex-col gap-2">
              <span className="inline-flex items-center gap-2 text-[12px] font-medium text-[var(--text-secondary)]">
                <Sparkles size={14} />
                动效选择
              </span>
              <select
                value={draft.ambientEffect}
                onChange={(event) => patch("ambientEffect", event.target.value as AmbientEffect)}
                disabled={!draft.enableAmbientEffect}
                className="surface-inset w-full px-3 py-2 text-[13px] outline-none disabled:cursor-not-allowed disabled:opacity-55"
              >
                {AMBIENT_EFFECT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <span className="text-[11px] leading-relaxed text-[var(--text-tertiary)]">
                关闭总开关时保留当前选择且不创建渲染层；移动端会自动降低粒子数量，系统减少动态效果时停止播放。
              </span>
            </label>
          </div>

          <div className="surface-inset flex flex-col gap-3 px-4 py-4">
            <div className="text-[13px] font-semibold text-[var(--text-primary)]">桌面端背景类型</div>
            <div className="instance-segmented">
              {BACKGROUND_MEDIA_TYPE_OPTIONS.map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  data-active={draft.backgroundMediaType === value ? "true" : "false"}
                  aria-pressed={draft.backgroundMediaType === value}
                  onClick={() => patch("backgroundMediaType", value)}
                  className="inline-flex items-center justify-center gap-2"
                >
                  <Icon size={14} />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="flex min-w-0 flex-col gap-2">
              <span className="text-[12px] font-medium text-[var(--text-secondary)]">
                桌面端背景图
              </span>
              <input
                value={draft.backgroundImage}
                onChange={(event) => patch("backgroundImage", event.target.value)}
                placeholder="https://example.com/bg.webp"
                aria-invalid={draftBackgroundImageInvalid}
                aria-describedby={draftBackgroundImageInvalid ? "background-image-error" : undefined}
                className="surface-inset w-full px-3 py-2 text-[13px] outline-none"
              />
              {draftBackgroundImageInvalid && (
                <span id="background-image-error" role="alert" className="text-[12px] text-[var(--status-offline)]">
                  请使用 HTTP(S) 图片地址或站内路径；特殊字符需编码，不支持 // 地址或内联图片。
                </span>
              )}
              <span className="text-[11px] text-[var(--text-tertiary)]">
                留空则不显示背景图；可用 <code>浅色图|深色图</code> 分别设置两种外观。
              </span>
            </label>
            <label className="flex min-w-0 flex-col gap-2">
              <span className="text-[12px] font-medium text-[var(--text-secondary)]">
                移动端背景图
              </span>
              <input
                value={draft.backgroundImageMobile}
                onChange={(event) => patch("backgroundImageMobile", event.target.value)}
                placeholder="留空则沿用桌面端背景图"
                aria-invalid={draftBackgroundImageMobileInvalid}
                aria-describedby={draftBackgroundImageMobileInvalid ? "background-mobile-image-error" : undefined}
                className="surface-inset w-full px-3 py-2 text-[13px] outline-none"
              />
              {draftBackgroundImageMobileInvalid && (
                <span id="background-mobile-image-error" role="alert" className="text-[12px] text-[var(--status-offline)]">
                  请使用 HTTP(S) 图片地址或站内路径；特殊字符需编码，不支持 // 地址或内联图片。
                </span>
              )}
              <span className="text-[11px] text-[var(--text-tertiary)]">
                屏宽不超过 720px 时生效；同样支持 <code>浅色图|深色图</code>。
              </span>
            </label>
          </div>

          {draft.backgroundMediaType === "video" && (
            <div className="grid gap-4 md:grid-cols-2">
              <label className="flex min-w-0 flex-col gap-2">
                <span className="text-[12px] font-medium text-[var(--text-secondary)]">
                  浅色模式视频
                </span>
                <input
                  value={draft.backgroundVideo}
                  onChange={(event) => patch("backgroundVideo", event.target.value)}
                  placeholder="https://example.com/light.mp4"
                  aria-invalid={backgroundVideoLightInvalid}
                  className="surface-inset w-full px-3 py-2 text-[13px] outline-none"
                />
                {backgroundVideoLightInvalid && (
                  <span className="text-[12px] text-[var(--status-offline)]">
                    {backgroundVideoLightMalformed
                      ? "请输入 HTTP(S) 或以 / 开头的站内视频直链"
                      : `视频模式需要浅色视频地址，可使用 ${DEFAULT_BACKGROUND_VIDEO_URL}`}
                  </span>
                )}
              </label>
              <label className="flex min-w-0 flex-col gap-2">
                <span className="text-[12px] font-medium text-[var(--text-secondary)]">
                  深色模式视频（可选）
                </span>
                <input
                  value={draft.backgroundVideoDark}
                  onChange={(event) => patch("backgroundVideoDark", event.target.value)}
                  placeholder="留空则沿用浅色模式视频"
                  aria-invalid={backgroundVideoDarkInvalid}
                  className="surface-inset w-full px-3 py-2 text-[13px] outline-none"
                />
                {backgroundVideoDarkInvalid && (
                  <span className="text-[12px] text-[var(--status-offline)]">
                    请输入 HTTP(S) 或以 / 开头的站内视频直链
                  </span>
                )}
              </label>
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <div className="surface-inset flex flex-col gap-3 px-4 py-4">
              <div className="text-[13px] font-semibold text-[var(--text-primary)]">缩放方式</div>
              <div className="instance-segmented is-scrollable">
                {BACKGROUND_SIZE_OPTIONS.map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    data-active={draftBgAlignment.size === value ? "true" : "false"}
                    aria-pressed={draftBgAlignment.size === value}
                    onClick={() => setBgSize(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="surface-inset flex flex-col gap-3 px-4 py-4">
              <div className="text-[13px] font-semibold text-[var(--text-primary)]">对齐位置</div>
              <div className="instance-segmented is-scrollable">
                {BACKGROUND_POSITION_OPTIONS.map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    data-active={draftBgAlignment.position === value ? "true" : "false"}
                    aria-pressed={draftBgAlignment.position === value}
                    onClick={() => setBgPosition(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="surface-inset flex flex-col gap-3 px-4 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-[13px] font-semibold text-[var(--text-primary)]">
                卡片不透明度
              </span>
              <span className="inline-flex items-center gap-1.5">
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  inputMode="numeric"
                  value={draft.surfaceOpacityText}
                  onChange={(event) => patch("surfaceOpacityText", event.target.value)}
                  onBlur={() => {
                    const normalized =
                      draft.surfaceOpacityText.trim() === ""
                        ? seededThemeSettings.surfaceOpacity
                        : normalizeSurfaceOpacity(draft.surfaceOpacityText);
                    patch("surfaceOpacityText", String(normalized));
                  }}
                  aria-label="卡片不透明度百分比"
                  className="surface-inset w-20 px-3 py-2 text-right text-[13px] tabular outline-none"
                />
                <span className="text-[13px] font-medium text-[var(--text-tertiary)]">%</span>
              </span>
            </div>
            <span className="text-[11px] leading-relaxed text-[var(--text-tertiary)]">
              输入 0–100 的整数。100 = 完全不透明（与默认主题一致），数值越低卡片越通透、越能透出自定义背景。
              {hasBackgroundMedia
                ? " 低于 95 时会自动在背景上叠加可读性遮罩，保证文字清晰；卡片本身保持纯半透明。"
                : !isMobileViewport && draft.enableMapBackground
                  ? " 已启用地图背景，保存后生效。"
                  : isMobileViewport
                    ? " 需先设置自定义背景后才会生效。"
                    : " 需先设置自定义背景或开启地图背景后才会生效。"}
            </span>
          </div>
        </div>
      </InstancePanel>

      <InstancePanel
        kicker={<><span className="instance-panel-kicker-num">04</span>首页</>}
        title="首页巡检"
        description="控制首页顶部总览、分组筛选和节点排序方式；适合节点较多时快速查看状态。"
        aside={<ListFilter size={16} />}
      >
        <div className="mb-4 grid gap-3 md:grid-cols-2">
          <ToggleRow
            field="enableHomeHeaderAutoHide"
            title="定时隐藏顶部信息"
            desc="首页加载完成后，同时隐藏站点名称与右上角快捷设置；刷新页面后重新显示。"
            checked={draft.enableHomeHeaderAutoHide}
            onPatch={patch}
          />
          <div className="surface-inset flex items-center justify-between gap-3 px-4 py-3">
            <span className="min-w-0">
              <span className="block text-[13px] font-medium text-[var(--text-primary)]">
                显示时长
              </span>
              <span className="mt-1 block text-[11px] text-[var(--text-tertiary)]">
                可设置 1–3600 秒，默认 10 秒。
              </span>
            </span>
            <span className="inline-flex shrink-0 items-center gap-1.5">
              <input
                type="number"
                min={1}
                max={3600}
                step={1}
                inputMode="numeric"
                value={draft.homeHeaderVisibleSecondsText}
                disabled={!draft.enableHomeHeaderAutoHide}
                onChange={(event) => patch("homeHeaderVisibleSecondsText", event.target.value)}
                onBlur={() => {
                  const normalized =
                    draft.homeHeaderVisibleSecondsText.trim() === ""
                      ? seededThemeSettings.homeHeaderVisibleSeconds
                      : normalizeHomeHeaderVisibleSeconds(draft.homeHeaderVisibleSecondsText);
                  patch("homeHeaderVisibleSecondsText", String(normalized));
                }}
                aria-label="顶部信息显示时长（秒）"
                className="surface-inset w-20 px-3 py-2 text-right text-[13px] tabular outline-none disabled:opacity-45"
              />
              <span className="text-[13px] font-medium text-[var(--text-tertiary)]">秒</span>
            </span>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <ToggleRow
            field="showHomeOverview"
            title="显示顶部总览"
            desc="展示时间、在线数、地区、流量和速率。"
            checked={draft.showHomeOverview}
            onPatch={patch}
          />
          <ToggleRow
            field="showGroupTabs"
            title="显示分组筛选"
            desc="根据后端节点分组生成首页 Tab。"
            checked={draft.showGroupTabs}
            onPatch={patch}
          />
          <ToggleRow
            field="showRegionBar"
            title="显示地区筛选"
            desc="按节点地区生成国旗筛选栏，点击某地区只看该地区节点。"
            checked={draft.showRegionBar}
            onPatch={patch}
          />
          <ToggleRow
            field="showCardGroup"
            title="卡片显示分组"
            desc="关闭后卡片内不再显示节点分组名（不影响分组筛选栏与备注）。"
            checked={draft.showCardGroup}
            onPatch={patch}
          />
          <ToggleRow
            field="enableHomeSort"
            title="启用排序切换"
            desc="首页显示排序控件，访客可临时切换排序方式（离线节点恒定置底）。"
            checked={draft.enableHomeSort}
            onPatch={patch}
          />
          <ToggleRow
            field="hideAdminEntryWhenLoggedOut"
            title="未登录时隐藏后台入口"
            desc="仅隐藏访客看到的“后台登录”；/admin 仍可直接访问，登录后自动显示“管理”。"
            checked={draft.hideAdminEntryWhenLoggedOut}
            onPatch={patch}
          />
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,0.6fr)]">
          <div>
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <span className="text-[13px] font-medium text-[var(--text-primary)]">默认排序维度</span>
              <span className="text-[11px] text-[var(--text-tertiary)]">
                首次访问时的初始排序；访客可临时切换。
              </span>
            </div>
            <div className="instance-segmented is-scrollable">
              {HOME_SORT_FIELDS.map((field) => (
                <button
                  key={field}
                  type="button"
                  data-active={draft.homeSortField === field ? "true" : "false"}
                  aria-pressed={draft.homeSortField === field}
                  disabled={!draft.enableHomeSort}
                  onClick={() => patch("homeSortField", field)}
                >
                  {HOME_SORT_FIELD_LABELS[field]}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-2 text-[13px] font-medium text-[var(--text-primary)]">默认方向</div>
            <div className="instance-segmented">
              <button
                type="button"
                data-active={draft.homeSortDirection === "asc" ? "true" : "false"}
                aria-pressed={draft.homeSortDirection === "asc"}
                disabled={!draft.enableHomeSort}
                onClick={() => patch("homeSortDirection", "asc")}
              >
                升序
              </button>
              <button
                type="button"
                data-active={draft.homeSortDirection === "desc" ? "true" : "false"}
                aria-pressed={draft.homeSortDirection === "desc"}
                disabled={!draft.enableHomeSort}
                onClick={() => patch("homeSortDirection", "desc")}
              >
                降序
              </button>
            </div>
          </div>
        </div>

        <div className="mt-4 surface-inset px-4 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <span className="min-w-0">
              <span className="block text-[13px] font-semibold text-[var(--text-primary)]">
                总览评级
              </span>
              <span className="mt-1 block text-[11px] text-[var(--text-tertiary)]">
                在累计流量、实时带宽、资产概览右下角显示文字评级；名称用英文逗号分隔，只取前四个。
              </span>
            </span>
            <label className="inline-flex shrink-0 items-center gap-2 text-[12px] font-medium text-[var(--text-secondary)]">
              <span>启用</span>
              <input
                type="checkbox"
                checked={draft.showOverviewRatings}
                onChange={(event) => patch("showOverviewRatings", event.target.checked)}
                className="h-4 w-4 accent-[var(--accent-500)]"
              />
            </label>
          </div>

          <div className="mt-3 grid gap-3 md:grid-cols-3">
            {OVERVIEW_RATING_LABEL_FIELDS.map((field) => {
              const defaultLabel = getDefaultOverviewRatingLabelText(field.key);
              const ratingEnabled = draft.showOverviewRatings && draft[field.toggleKey];
              return (
                <div key={field.key} className="flex min-w-0 flex-col gap-2">
                  <label className="flex items-center justify-between gap-2 text-[12px] font-medium text-[var(--text-secondary)]">
                    <span>{field.title}</span>
                    <input
                      type="checkbox"
                      checked={draft[field.toggleKey]}
                      disabled={!draft.showOverviewRatings}
                      onChange={(event) => patch(field.toggleKey, event.target.checked)}
                      className="h-4 w-4 shrink-0 accent-[var(--accent-500)]"
                    />
                  </label>
                  <input
                    value={draft.ratingLabels[field.key]}
                    disabled={!ratingEnabled}
                    onChange={(event) => setRatingLabelDraft(field.key, event.target.value)}
                    placeholder={defaultLabel}
                    aria-label={`${field.title}评级名称`}
                    className="surface-inset w-full px-3 py-2 text-[13px] outline-none disabled:opacity-60"
                  />
                  <span className="text-[11px] text-[var(--text-tertiary)]">
                    例如: {defaultLabel}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </InstancePanel>

      <InstancePanel
        kicker={<><span className="instance-panel-kicker-num">05</span>隐藏</>}
        title="隐藏节点"
        description="在此填写的节点会从首页彻底移除：不显示卡片，也不计入在线数、累计流量、实时带宽与资产等所有统计。对所有访客生效，清空即可恢复。"
        aside={<EyeOff size={16} />}
      >
        <label className="flex min-w-0 flex-col gap-2">
          <span className="text-[12px] font-medium text-[var(--text-secondary)]">
            隐藏列表
          </span>
          <textarea
            value={draft.hiddenNodesText}
            onChange={(event) => patch("hiddenNodesText", event.target.value)}
            placeholder="每行一个节点名称 / UUID，也可以用逗号分隔"
            className="surface-inset min-h-[112px] w-full resize-y px-3 py-2 text-[13px] outline-none"
          />
          <span className="text-[11px] text-[var(--text-tertiary)]">
            已隐藏 {draftHiddenNodes.length} 个节点。按名称或 UUID 匹配，大小写不敏感。
          </span>
        </label>
      </InstancePanel>

      <InstancePanel
        kicker={<><span className="instance-panel-kicker-num">06</span>卡片</>}
        title="卡片显示项"
        description="分别管理跨卡片视图的功能入口，以及小卡片专属的信息密度。"
        aside={<Rows3 size={16} />}
      >
        <div>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="text-[13px] font-medium text-[var(--text-primary)]">跨视图设置</span>
            <span className="text-[11px] text-[var(--text-tertiary)]">
              适用于多个卡片尺寸，具体范围以每项说明为准。
            </span>
          </div>
          <div className="mt-2 grid gap-3 md:grid-cols-2">
            <ToggleRow
              field="showTodayTrafficPopover"
              title="显示今日流量悬浮窗"
              desc="在大卡片、小卡片与迷你卡片标题旁显示入口；鼠标悬浮或点击可查看今日流量与峰值速度。默认开启。"
              checked={draft.showTodayTrafficPopover}
              onPatch={patch}
            />
            <ToggleRow
              field="showMerchantLinks"
              title="显示商家链接入口"
              desc="在大卡片、小卡片与迷你卡片标题旁显示商家入口。默认关闭；与今日流量同时开启时位于其左侧。"
              checked={draft.showMerchantLinks}
              onPatch={patch}
            />
            <ToggleRow
              field="showConnections"
              title="显示连接数（TCP/UDP）"
              desc="在大卡片与小卡片展示实时 TCP / UDP 连接数；需被控端上报，未上报显示 0。默认关闭。"
              checked={draft.showConnections}
              onPatch={patch}
            />
          </div>
          <MerchantLinkConfigControl
            clients={sortedClients}
            links={draft.nodeMerchantLinks}
            configuredNodeCount={merchantConfiguredNodeCount}
            enabled={draft.showMerchantLinks}
            disabled={clientsLoading || Boolean(clientsError)}
            saving={saving}
            saveDisabled={saveDisabled}
            saveError={error || draftUrlValidationError}
            onChange={patchNodeMerchantLinks}
            onSave={handleSave}
          />
        </div>

        <div className="mt-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="text-[13px] font-medium text-[var(--text-primary)]">小卡片专属</span>
            <span className="text-[11px] text-[var(--text-tertiary)]">
              控制小卡片中间信息块的密度；实时速率始终显示。
            </span>
          </div>
          <div className="mt-2 grid gap-3 md:grid-cols-2">
            <ToggleRow
              field="compactShowTrafficTotal"
              title="显示累计流量"
              desc="展示出站与入站累计流量。"
              checked={draft.compactShowTrafficTotal}
              onPatch={patch}
            />
            <ToggleRow
              field="compactShowBilling"
              title="显示费用到期"
              desc="展示续费价格与剩余天数。"
              checked={draft.compactShowBilling}
              onPatch={patch}
            />
            <ToggleRow
              field="compactShowUptime"
              title="显示在线时间"
              desc="在小卡片流量栏右侧展示在线时长。默认开启。"
              checked={draft.compactShowUptime}
              onPatch={patch}
            />
          </div>
        </div>
      </InstancePanel>

      <InstancePanel
        title="流量重置日"
        description="按服务器设置每月重置日，未自定义的服务器继续按账单到期日推算。"
      >
        <TrafficResetConfigControl
          clients={sortedClients}
          days={draft.trafficResetDays}
          configuredNodeCount={trafficResetConfiguredNodeCount}
          now={now}
          disabled={clientsLoading || Boolean(clientsError)}
          saving={saving}
          saveDisabled={saveDisabled}
          saveError={error || draftUrlValidationError}
          onChange={patchTrafficResetDays}
          onSave={handleSave}
        />
      </InstancePanel>

      <InstancePanel
        kicker={<><span className="instance-panel-kicker-num">07</span>花费</>}
        title="服务器花费"
        description="资产统计页（/assets）使用实时汇率计算年化总支出、月均支出与剩余价值；忽略列表中的节点不会计入费用。两个入口开关都关闭时，直接访问资产页也会跳回首页。"
        aside={<CircleDollarSign size={16} />}
      >
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.8fr)]">
          <div className="flex flex-col gap-3">
            <ToggleRow
              field="showCostsToGuests"
              title="向未登录访客公开费用"
              desc="关闭后，续费价格、资产统计和价格排序仅登录管理员可见；到期时间仍正常显示。"
              checked={draft.showCostsToGuests}
              onPatch={patch}
            />
            <ToggleRow
              field="showCostSummary"
              title="显示资产页入口按钮"
              desc="在首页资产概览卡右上角显示进入资产统计页的按钮。"
              checked={draft.showCostSummary}
              onPatch={patch}
            />
            <ToggleRow
              field="showCostSummaryFloatingButton"
              title="显示资产悬浮按钮"
              desc="卡内入口不可用时（总览隐藏或其开关关闭），以悬浮按钮进入资产统计页。"
              checked={draft.showCostSummaryFloatingButton}
              onPatch={patch}
            />
            <label className="flex flex-col gap-2">
              <span className="text-[12px] font-medium text-[var(--text-secondary)]">
                实时汇率接口
              </span>
              <input
                value={draft.costRateApiUrl}
                onChange={(event) => patch("costRateApiUrl", event.target.value)}
                placeholder={DEFAULT_THEME_SETTINGS.costRateApiUrl}
                aria-invalid={draftCostRateApiUrlInvalid}
                className="surface-inset w-full px-3 py-2 text-[13px] outline-none"
              />
              {draftCostRateApiUrlInvalid && (
                <span className="text-[12px] text-[var(--status-offline)]">
                  请输入有效的 http(s) 链接，或留空以使用默认接口
                </span>
              )}
            </label>
          </div>
          <label className="flex min-w-0 flex-col gap-2">
            <span className="text-[12px] font-medium text-[var(--text-secondary)]">
              忽略计费节点
            </span>
            <textarea
              value={draft.costIgnoredText}
              onChange={(event) => patch("costIgnoredText", event.target.value)}
              placeholder="每行一个节点名称 / UUID，也可以用逗号分隔"
              className="surface-inset min-h-[112px] w-full resize-y px-3 py-2 text-[13px] outline-none"
            />
          </label>
        </div>
      </InstancePanel>

      <InstancePanel
        kicker={<><span className="instance-panel-kicker-num">08</span>溢价</>}
        title="收购溢价"
        description="填写实际收购价（人民币），系统使用当前价格、周期、到期日和汇率回算收购日的剩余价值，再固化溢价（收购价 − 收购日剩余价值，可正可负）。后续续费和汇率变化不会自动改写；主动修改收购日期时会重新计算并固化。收购日期同时用于溢价月摊与尚未摊销价值；免费节点的收购价全额记为溢价，留空即清除记录。"
        aside={
          <div className="text-[11px] text-[var(--text-tertiary)]">
            {clientsLoading ? "载入中" : `已设置 ${premiumConfiguredCount} 个节点`}
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          <label className="surface-inset flex items-center gap-2 px-3 py-2">
            <Search size={14} className="text-[var(--text-tertiary)]" />
            <input
              value={premiumSearch}
              onChange={(event) => setPremiumSearch(event.target.value)}
              placeholder="搜索节点名称 / UUID / 分组 / 地区"
              aria-label="搜索节点"
              className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-[var(--text-tertiary)]"
            />
          </label>

          {clientsLoading && (
            <div className="flex min-h-[15vh] items-center justify-center">
              <Spinner size={24} />
            </div>
          )}

          {!clientsLoading && sortedClients.length === 0 && (
            <div className="theme-manage-empty-state">
              <span>还没有任何节点。</span>
            </div>
          )}

          {!clientsLoading && sortedClients.length > 0 && filteredPremiumClients.length === 0 && (
            <div className="surface-inset px-4 py-5 text-[13px] text-[var(--text-secondary)]">
              没有匹配的节点。
            </div>
          )}

          {!clientsLoading && filteredPremiumClients.length > 0 && (
            <PremiumList
              clients={filteredPremiumClients}
              costPremiums={draft.costPremiums}
              detailByUuid={premiumDetailByUuid}
              rateLoading={premiumRateQuery.isLoading}
              acquiredAtMax={acquiredAtMax}
              onPatchPaid={patchPremiumPaid}
              onPatchAcquiredAt={patchPremiumAcquiredAt}
            />
          )}
        </div>
      </InstancePanel>

      <InstancePanel
        kicker={<><span className="instance-panel-kicker-num">09</span>延迟</>}
        title="主页延迟检测"
        description={
          <>
            单线路模式为每个节点绑定一项 Ping 任务；开启三网模式后，大卡片和小卡片默认展示三项全局任务，也可以为每台服务器单独覆盖探测点。迷你卡片与列表仍显示节点的单线路绑定。
            {" "}
            如果当前还没有可用任务，请先前往
            {" "}
            <a href={adminPingHref} className="theme-manage-inline-link">
              后台 Ping 管理
            </a>
            {" "}
            创建任务，再回来完成绑定。
          </>
        }
        aside={
          <div className="text-[11px] text-[var(--text-tertiary)]">
            {tasksLoading || clientsLoading
              ? "载入中"
              : draft.enableHomepageMultiPing
                ? `已覆盖 ${multiPingConfiguredNodeCount} 台`
                : `${sortedTasks.length} 个任务`}
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          <div
            className={clsx(
              "surface-inset px-4 py-4",
              draft.enableHomepageMultiPing &&
                "border-[color-mix(in_srgb,var(--accent-500)_32%,var(--hairline))]",
            )}
          >
            <label className="flex items-start justify-between gap-4">
              <span className="min-w-0">
                <span className="block text-[13px] font-medium text-[var(--text-primary)]">
                  开启三网模式
                </span>
                <span className="mt-1 block text-[11px] leading-relaxed text-[var(--text-tertiary)]">
                  大卡片和小卡片使用三网延迟；未单独配置的服务器继承下面的全局默认线路。
                </span>
              </span>
              <input
                type="checkbox"
                checked={draft.enableHomepageMultiPing}
                disabled={
                  !draft.enableHomepageMultiPing &&
                  !tasksLoading &&
                  sortedTasks.length < HOMEPAGE_MULTI_PING_TASK_COUNT
                }
                onChange={(event) =>
                  patch("enableHomepageMultiPing", event.target.checked)
                }
                className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent-500)]"
              />
            </label>

            {draft.enableHomepageMultiPing && (
              <div className="mt-4 border-t border-[var(--hairline)] pt-4">
                <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-[12px] font-medium text-[var(--text-primary)]">
                    全局默认线路
                  </span>
                  <span className="text-[11px] text-[var(--text-tertiary)]">
                    按顺序显示在节点卡片中
                  </span>
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  {Array.from(
                    { length: HOMEPAGE_MULTI_PING_TASK_COUNT },
                    (_, slot) => {
                      const selectedTaskId =
                        draft.homepageMultiPingTaskSlots[slot];
                      return (
                        <label key={slot} className="min-w-0">
                          <span className="mb-1.5 block text-[11px] font-medium text-[var(--text-secondary)]">
                            线路 {slot + 1}
                          </span>
                          <select
                            value={selectedTaskId ?? ""}
                            onChange={(event) =>
                              patchMultiPingTask(slot, event.target.value)
                            }
                            aria-label={`三网线路 ${slot + 1}`}
                            className="surface-inset w-full px-3 py-2 text-[13px] text-[var(--text-primary)] outline-none"
                          >
                            <option value="">选择 Ping 任务</option>
                            {selectedTaskId != null &&
                              !sortedTasks.some((task) => task.id === selectedTaskId) && (
                                <option value={selectedTaskId}>
                                  任务 #{selectedTaskId}（当前不可用）
                                </option>
                              )}
                            {sortedTasks.map((task) => (
                              <option
                                key={task.id}
                                value={task.id}
                                disabled={
                                  task.id !== selectedTaskId &&
                                  draft.homepageMultiPingTaskSlots.includes(task.id)
                                }
                              >
                                {task.name || `任务 #${task.id}`}
                              </option>
                            ))}
                          </select>
                        </label>
                      );
                    },
                  )}
                </div>
                <p
                  className={clsx(
                    "mt-3 text-[11px] leading-relaxed",
                    draftMultiPingInvalid
                      ? "text-[var(--status-error)]"
                      : "text-[var(--text-tertiary)]",
                  )}
                  role={draftMultiPingInvalid ? "alert" : undefined}
                >
                  {draftMultiPingInvalid
                    ? "请选满 3 个不同的 Ping 任务后再保存。"
                    : "未设置单独覆盖的服务器都会使用这三项任务。"}
                </p>

                <MultiPingNodeConfigControl
                  clients={sortedClients}
                  tasks={sortedTasks}
                  globalTaskIds={draftMultiPingTaskIds}
                  nodeTaskIds={draft.homepageMultiPingNodeTaskIds}
                  configuredNodeCount={multiPingConfiguredNodeCount}
                  fakePingForUnbound={draft.fakePingForUnbound}
                  disabled={draftMultiPingInvalid || clientsLoading || tasksLoading}
                  saving={saving}
                  saveError={error || draftUrlValidationError}
                  saveDisabled={saveDisabled}
                  onChange={patchNodeMultiPingTaskIds}
                  onSave={handleSave}
                />
              </div>
            )}
          </div>

          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(240px,320px)]">
            <label className="surface-inset flex items-center gap-2 px-3 py-2">
              <Search size={14} className="text-[var(--text-tertiary)]" />
              <input
                value={taskSearch}
                onChange={(event) => setTaskSearch(event.target.value)}
                placeholder="搜索 Ping 任务名称 / ID / 类型 / 目标"
                aria-label="搜索 Ping 任务"
                className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-[var(--text-tertiary)]"
              />
            </label>
            <div className="surface-inset flex items-center justify-between gap-3 px-3 py-2 text-[12px] text-[var(--text-secondary)]">
              <span>首页绑定总数</span>
              <strong className="text-[var(--text-primary)]">
                {draft.enableHomepageMultiPing
                  ? `${multiPingConfiguredNodeCount} 台单独覆盖`
                  : `${assignedNodeCount} / ${sortedClients.length}`}
              </strong>
            </div>
          </div>

          {draft.enableHomepageMultiPing && (
            <div className="text-[11px] text-[var(--text-tertiary)]">
              下方单线路绑定继续用于迷你卡片和列表；大卡片与小卡片使用上方三项任务。
            </div>
          )}

          <ToggleRow
            field="fakePingForUnbound"
            title="未绑定探测点显示模拟延迟"
            desc="用户主动开启后，未绑定单线路 Ping 任务的在线节点，以及三网模式中后台未绑定的探测点，都会显示前端生成的模拟数据（延迟 1-10ms、丢包 0%）。模拟数据仅用于视觉统一，不代表真实网络质量。"
            checked={draft.fakePingForUnbound}
            onPatch={patch}
          />

          {(tasksLoading || clientsLoading) && (
            <div className="flex min-h-[20vh] items-center justify-center">
              <Spinner size={24} />
            </div>
          )}

          {noTasksYet && (
            <div className="theme-manage-empty-state">
              <span>当前还没有可用于首页展示的 Ping 任务。</span>
              <a href={adminPingHref} className="theme-manage-inline-link">
                前往后台 Ping 管理创建任务
              </a>
            </div>
          )}

          {noFilteredTaskMatch && (
            <div className="surface-inset px-4 py-5 text-[13px] text-[var(--text-secondary)]">
              没有匹配的 Ping 任务。
            </div>
          )}

          {!tasksLoading &&
            !clientsLoading &&
            !noTasksYet &&
            filteredTasks.map((task) => {
              const expanded = expandedTaskId === task.id;
              return (
                <TaskBindingSection
                  key={task.id}
                  task={task}
                  assigned={
                    draft.homepagePingBindings[String(task.id)] ?? EMPTY_ASSIGNED_CLIENTS
                  }
                  expanded={expanded}
                  clientsById={clientsById}
                  // 收起的卡片收到稳定空值:节点搜索的每次击键只重渲展开的那一张。
                  visibleClients={expanded ? visibleClients : EMPTY_ADMIN_CLIENTS}
                  assignedTaskByClientUuid={assignedTaskByClientUuid}
                  nodeSearch={expanded ? nodeSearch : ""}
                  onNodeSearch={setNodeSearch}
                  onToggleExpand={toggleTaskExpanded}
                  onPatchBindings={patchBindings}
                />
              );
            })}
        </div>
      </InstancePanel>

    </div>
  );
}
