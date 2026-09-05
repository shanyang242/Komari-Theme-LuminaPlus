import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
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
  Sun,
  SunMoon,
  Video,
  Wallpaper,
} from "lucide-react";
import { clsx } from "clsx";
import { InstancePanel } from "@/components/instance/InstancePanel";
import { MultiPingNodeConfigPanel } from "@/components/theme/MultiPingNodeConfigPanel";
import { Spinner } from "@/components/ui/Spinner";
import { Flag } from "@/components/ui/Flag";
import { usePublicConfig } from "@/hooks/usePublicConfig";
import { useHourlyClock } from "@/hooks/useClock";
import { queryClient } from "@/services/queryClient";
import {
  ApiRequestError,
  getAdminClients,
  getAdminPingTasks,
  getNodes,
  saveThemeSettings,
} from "@/services/api";
import type { AdminClient, PingTask, ThemeSettings } from "@/types/komari";
import {
  DEFAULT_BACKGROUND_VIDEO_URL,
  type BackgroundPosition,
  type BackgroundSize,
  normalizeBackgroundAlignment,
  normalizeBackgroundUrl,
  normalizeBackgroundVideoUrl,
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
  dedupeGroupLabels,
  normalizeHomeGroupOrder,
  sortHomeGroupOptions,
} from "@/utils/homeNodes";
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
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
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
    homeGroupOrder: settings.homeGroupOrder,
    enableHomeSort: settings.enableHomeSort,
    homeSortField: settings.homeSortField,
    homeSortDirection: settings.homeSortDirection,
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

function managedSettingsSignature(settings: ThemeSettings & Record<string, unknown>) {
  return JSON.stringify(pickManagedThemeSettings(normalizeThemeSettings(settings)));
}

type ManagedThemeSettings = ReturnType<typeof pickManagedThemeSettings>;

// 表单草稿:与托管设置同名同构,仅三处以「编辑态」存储——隐藏/忽略列表在表单里是多行文本
// (提交时再归一化回数组),三个评级名称合成按 kind 索引的对象(UI 按 OVERVIEW_RATING_LABEL_FIELDS
// 循环渲染)。其余字段直接透传,不维护第二份键清单。
type ThemeDraft = Omit<
  ManagedThemeSettings,
  | "hiddenNodes"
  | "costIgnoredNodes"
  | "trafficRatingLabels"
  | "bandwidthRatingLabels"
  | "assetRatingLabels"
> & {
  ratingLabels: Record<OverviewRatingKind, string>;
  hiddenNodesText: string;
  costIgnoredText: string;
};

// 服务端设置 → 表单草稿。reseed effect 和重置按钮都经 seedDrafts 走这里。
function draftFromSettings(settings: ResolvedThemeSettings): ThemeDraft {
  const {
    hiddenNodes,
    costIgnoredNodes,
    trafficRatingLabels,
    bandwidthRatingLabels,
    assetRatingLabels,
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

export function ThemeManage() {
  const now = useHourlyClock();
  const {
    data: config,
    isLoading: configLoading,
    error: configError,
    refetch: refetchConfig,
  } = usePublicConfig();
  // 全部托管设置收敛为单个草稿对象。之前是 30 个平行 useState,每新增一项设置要同步维护
  // 声明/seedDrafts/payload/依赖数组四处清单;现在键清单只在 pickManagedThemeSettings 一处。
  const [draft, setDraft] = useState<ThemeDraft>(() =>
    draftFromSettings(DEFAULT_THEME_SETTINGS),
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

  // 单字段更新收口,所有表单控件都走它。值未变时原样返回 prev,保留旧的独立 useState
  // 在同值 set 时不触发重渲染的行为。
  const patch = useCallback(
    <K extends keyof ThemeDraft>(key: K, value: ThemeDraft[K]) => {
      editVersionRef.current += 1;
      setDraft((prev) => (Object.is(prev[key], value) ? prev : { ...prev, [key]: value }));
    },
    [],
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
      const nextIds = [...prev.homepageMultiPingTaskIds];
      if (rawValue === "") {
        nextIds.splice(slot, 1);
      } else {
        nextIds[slot] = Number(rawValue);
      }
      const homepageMultiPingTaskIds = normalizeHomepageMultiPingTaskIds(nextIds);
      return JSON.stringify(homepageMultiPingTaskIds) ===
        JSON.stringify(prev.homepageMultiPingTaskIds)
        ? prev
        : { ...prev, homepageMultiPingTaskIds };
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

  const sourceThemeSettings = useMemo(
    () => normalizeThemeSettings(config?.theme_settings),
    [config?.theme_settings],
  );
  // 按内容判断服务端设置是否真的变化，避免同内容 refetch 重置草稿。
  const sourceSignature = useMemo(
    () => JSON.stringify(pickManagedThemeSettings(sourceThemeSettings)),
    [sourceThemeSettings],
  );
  const lastSeededSignatureRef = useRef<string | null>(null);

  // 把服务端设置灌入草稿的唯一出口,reseed effect 和重置按钮都走它,避免两边逻辑漂移。
  const seedDrafts = useCallback((next: ResolvedThemeSettings) => {
    setDraft(draftFromSettings(next));
  }, []);

  const sortedTasks = useMemo(() => sortTasks(pingTasks ?? []), [pingTasks]);
  const sortedClients = useMemo(() => sortClients(adminClients ?? []), [adminClients]);
  const clientsById = useMemo(
    () => new Map(sortedClients.map((client) => [client.uuid, client])),
    [sortedClients],
  );

  // 后端实际存在的分组,按首页 Tab 的渲染顺序排列(已配置的在前,未排序的在后)。
  // 用户直接拖动这个列表来调整顺序。
  const availableGroups = useMemo(
    () => dedupeGroupLabels(sortedClients.map((client) => client.group)),
    [sortedClients],
  );
  const orderedDraftGroups = useMemo(
    () => sortHomeGroupOptions(availableGroups, draft.homeGroupOrder),
    [availableGroups, draft.homeGroupOrder],
  );
  const moveGroup = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= orderedDraftGroups.length) return;
    const next = [...orderedDraftGroups];
    [next[index], next[target]] = [next[target], next[index]];
    patch("homeGroupOrder", next);
  };

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
    () => Object.keys(draft.costPremiums).length,
    [draft.costPremiums],
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
  const draftCostRateApiUrlInvalid =
    draft.costRateApiUrl.trim() !== "" && !isCostRateApiUrlValid(draft.costRateApiUrl.trim());
  const draftMultiPingInvalid =
    draft.enableHomepageMultiPing &&
    draft.homepageMultiPingTaskIds.length !== HOMEPAGE_MULTI_PING_TASK_COUNT;

  // 由当前草稿拼出的设置 payload,保存请求和 dirty 判断都用它。草稿字段与设置同名,这里只做
  // 「编辑态 → 存储态」的换形与归一化;文本域(hiddenNodesText/costIgnoredText)和 ratingLabels
  // 解构出来换回存储字段,其余原样透传。
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
      ...rest
    } = draft;
    return {
      ...rest,
      homepagePingBindings: pruneBindings(rest.homepagePingBindings),
      homepageMultiPingNodeTaskIds: normalizeHomepageMultiPingNodeTaskIds(
        rest.homepageMultiPingNodeTaskIds,
      ),
      homeGroupOrder: normalizeHomeGroupOrder(rest.homeGroupOrder),
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
        ? sourceThemeSettings.backgroundVideo
        : normalizedBackgroundVideo || DEFAULT_BACKGROUND_VIDEO_URL,
      backgroundVideoDark: backgroundVideoDarkInvalid
        ? sourceThemeSettings.backgroundVideoDark
        : normalizedBackgroundVideoDark,
      backgroundAlignment: normalizeBackgroundAlignment(rest.backgroundAlignment),
    };
  }, [
    backgroundVideoDarkInvalid,
    backgroundVideoLightMalformed,
    draft,
    normalizedBackgroundVideo,
    normalizedBackgroundVideoDark,
    sourceThemeSettings.backgroundVideo,
    sourceThemeSettings.backgroundVideoDark,
  ]);

  // 只比较本页实际管理的设置。enableAdminButton/showPingChart 这类隐藏设置会通过
  // baseSettings 在保存时保留,但不该让表单永远显示为 dirty。
  const draftSignature = useMemo(
    () => managedSettingsSignature(draftThemeSettings as ThemeSettings & Record<string, unknown>),
    [draftThemeSettings],
  );
  // draftSignature 用的是归一化后的 cost-rate URL,非法输入会被收敛回默认值,于是非法输入
  // 不会被判为 dirty,用户既无法保存也无法重置出来。所以单独跟踪原始文本,让编辑始终把表单
  // 标为 dirty(重置可用),而保存按钮再额外按合法性把关(见下文)。
  const costRateApiUrlDirty =
    draft.costRateApiUrl.trim() !== sourceThemeSettings.costRateApiUrl;
  const isDirty =
    draftSignature !== sourceSignature ||
    costRateApiUrlDirty ||
    videoInputInvalid;

  // 用户重新编辑后清掉「已保存」提示,避免过期的成功提示和 dirty 表单并存。
  useEffect(() => {
    if (isDirty) setMessage(null);
  }, [isDirty]);

  // 服务端设置真正变化时灌入草稿。首次灌入之后,只要表单有未保存编辑(含保存中)就跳过,
  // 避免 refetch / 其他端保存的回流静默覆盖用户草稿。
  useEffect(() => {
    if (!config) return;
    if (lastSeededSignatureRef.current === sourceSignature) return;
    if (lastSeededSignatureRef.current !== null && isDirty) return;
    lastSeededSignatureRef.current = sourceSignature;
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

  // 每个 client 归属哪个 task 的反查,只在绑定草稿变化时重建。与「全选可用」reducer
  // 共用 invertBindings() 避免推导漂移,并把可选节点过滤保持在 O(tasks × clients),
  // 而不是每个 client 都重扫一遍 bindings。
  const assignedTaskByClientUuid = useMemo(
    () => invertBindings(draft.homepagePingBindings),
    [draft.homepagePingBindings],
  );

  const handleSave = async (): Promise<boolean> => {
    if (
      !config?.theme ||
      savingDraftRef.current ||
      draftCostRateApiUrlInvalid ||
      videoInputInvalid ||
      draftMultiPingInvalid
    ) {
      return false;
    }
    const submittedEditVersion = editVersionRef.current;
    savingDraftRef.current = draft;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const nextSettings: ThemeSettings & Record<string, unknown> = {
        ...(config.theme_settings ?? {}),
        ...draftThemeSettings,
      };
      delete nextSettings.homepagePingTask;
      await saveThemeSettings(config.theme, nextSettings);
      await queryClient.invalidateQueries({ queryKey: ["public"] });
      if (editVersionRef.current === submittedEditVersion) {
        setMessage("主题设置已保存");
        return true;
      }
      return false;
    } catch (saveError) {
      if (
        saveError instanceof ApiRequestError &&
        (saveError.status === 401 || saveError.status === 403)
      ) {
        setAccessRevoked(true);
        return false;
      }
      setError(saveError instanceof Error ? saveError.message : "保存失败");
      return false;
    } finally {
      savingDraftRef.current = null;
      setSaving(false);
    }
  };

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

  if (accessRevoked) {
    return <Navigate to="/" replace />;
  }

  const adminAccessDenied =
    (tasksError instanceof ApiRequestError &&
      (tasksError.status === 401 || tasksError.status === 403)) ||
    (clientsError instanceof ApiRequestError &&
      (clientsError.status === 401 || clientsError.status === 403));

  if (adminAccessDenied) {
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
              disabled={
                !isDirty ||
                saving ||
                draftCostRateApiUrlInvalid ||
                videoInputInvalid ||
                draftMultiPingInvalid
              }
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

      {(message || error || adminError) && (
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
          {error && (
            <div
              role="alert"
              className="rounded-[12px] border border-[color-mix(in_srgb,var(--status-offline)_28%,transparent)] bg-[color-mix(in_srgb,var(--status-offline)_11%,var(--surface))] px-4 py-3 text-[13px] text-[var(--status-offline)]"
            >
              {error}
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
        description="为站点设置自定义背景图或桌面视频，并调节卡片不透明度。"
        aside={<Wallpaper size={16} />}
      >
        <div className="flex flex-col gap-4">
          <ToggleRow
            field="enableBackgroundImage"
            title="启用自定义背景"
            desc="关闭后不加载任何背景图或视频（下方 URL 配置会保留），站点回到纯色主题；再次开启即恢复。"
            checked={draft.enableBackgroundImage}
            onPatch={patch}
          />

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
                className="surface-inset w-full px-3 py-2 text-[13px] outline-none"
              />
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
                className="surface-inset w-full px-3 py-2 text-[13px] outline-none"
              />
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
                  value={draft.surfaceOpacity}
                  onChange={(event) => {
                    // Number("") === 0,没有这行的话清空输入框(想重新输入)会把值跳成 0。
                    if (event.target.value.trim() === "") return;
                    const next = Number(event.target.value);
                    if (!Number.isFinite(next)) return;
                    patch("surfaceOpacity", Math.min(100, Math.max(0, Math.round(next))));
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
                : " 需先在上方设置自定义背景后才会生效。"}
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
                value={draft.homeHeaderVisibleSeconds}
                disabled={!draft.enableHomeHeaderAutoHide}
                onChange={(event) => {
                  if (event.target.value.trim() === "") return;
                  patch(
                    "homeHeaderVisibleSeconds",
                    normalizeHomeHeaderVisibleSeconds(event.target.value),
                  );
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

        <div className="mt-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="text-[13px] font-medium text-[var(--text-primary)]">分组排序</span>
            <span className="text-[11px] text-[var(--text-tertiary)]">
              调整首页分组 Tab 的显示顺序；未列出的分组按后端顺序排在后面。
            </span>
          </div>
          {orderedDraftGroups.length === 0 ? (
            <p className="surface-inset mt-2 px-4 py-3 text-[12px] text-[var(--text-tertiary)]">
              {clientsLoading ? "正在加载分组…" : "暂无分组（节点未设置分组时无需排序）"}
            </p>
          ) : (
            <ul className="mt-2 flex flex-col gap-2">
              {orderedDraftGroups.map((group, index) => (
                <li
                  key={group}
                  className="surface-inset flex items-center justify-between gap-3 px-4 py-2.5"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="tabular text-[12px] text-[var(--text-tertiary)]">
                      {index + 1}
                    </span>
                    <span
                      className="truncate text-[13px] text-[var(--text-primary)]"
                      title={group}
                    >
                      {group}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      disabled={index === 0}
                      onClick={() => moveGroup(index, -1)}
                      className="theme-manage-button is-compact"
                      aria-label={`上移 ${group}`}
                    >
                      <ChevronUp size={14} />
                    </button>
                    <button
                      type="button"
                      disabled={index === orderedDraftGroups.length - 1}
                      onClick={() => moveGroup(index, 1)}
                      className="theme-manage-button is-compact"
                      aria-label={`下移 ${group}`}
                    >
                      <ChevronDown size={14} />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
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
              field="showConnections"
              title="显示连接数（TCP/UDP）"
              desc="在大卡片与小卡片展示实时 TCP / UDP 连接数；需被控端上报，未上报显示 0。默认关闭。"
              checked={draft.showConnections}
              onPatch={patch}
            />
          </div>
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
        kicker={<><span className="instance-panel-kicker-num">07</span>花费</>}
        title="服务器花费"
        description="资产统计页（/assets）使用实时汇率计算年化总支出、月均支出与剩余价值；忽略列表中的节点不会计入费用。两个入口开关都关闭时，直接访问资产页也会跳回首页。"
        aside={<CircleDollarSign size={16} />}
      >
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.8fr)]">
          <div className="flex flex-col gap-3">
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
                  请输入 http(s) 链接，保存后将回退默认接口
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
            <a href="/admin/ping" className="theme-manage-inline-link">
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
                        draft.homepageMultiPingTaskIds[slot];
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
                                  draft.homepageMultiPingTaskIds.includes(task.id)
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
                  globalTaskIds={draft.homepageMultiPingTaskIds}
                  nodeTaskIds={draft.homepageMultiPingNodeTaskIds}
                  configuredNodeCount={multiPingConfiguredNodeCount}
                  fakePingForUnbound={draft.fakePingForUnbound}
                  disabled={draftMultiPingInvalid || clientsLoading || tasksLoading}
                  saving={saving}
                  saveError={error}
                  saveDisabled={
                    !isDirty ||
                    draftCostRateApiUrlInvalid ||
                    videoInputInvalid ||
                    draftMultiPingInvalid
                  }
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
              <a href="/admin/ping" className="theme-manage-inline-link">
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
