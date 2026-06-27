import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  CircleDollarSign,
  EyeOff,
  LayoutTemplate,
  LayoutGrid,
  ListFilter,
  Moon,
  RefreshCw,
  Rows3,
  Save,
  Search,
  Sun,
  SunMoon,
  Wallpaper,
} from "lucide-react";
import { clsx } from "clsx";
import { InstancePanel } from "@/components/instance/InstancePanel";
import { Spinner } from "@/components/ui/Spinner";
import { Flag } from "@/components/ui/Flag";
import { usePublicConfig } from "@/hooks/usePublicConfig";
import { queryClient } from "@/services/queryClient";
import {
  ApiRequestError,
  getAdminClients,
  getAdminPingTasks,
  saveThemeSettings,
} from "@/services/api";
import type { AdminClient, PingTask, ThemeSettings } from "@/types/komari";
import {
  type BackgroundPosition,
  type BackgroundSize,
  normalizeBackgroundAlignment,
  normalizeBackgroundUrl,
  parseBackgroundAlignment,
} from "@/utils/background";
import {
  isCostRateApiUrlValid,
  normalizeCostIgnoredNodes,
  normalizeCostRateApiUrl,
} from "@/utils/cost";
import { normalizeNodeIdentityList } from "@/utils/nodeIdentity";
import {
  dedupeGroupLabels,
  normalizeHomeGroupOrder,
  sortHomeGroupOptions,
} from "@/utils/homeNodes";
import {
  normalizeHomepagePingTaskBindings,
  type HomepagePingTaskBindings,
} from "@/utils/pingTasks";
import {
  DEFAULT_THEME_SETTINGS,
  normalizeThemeSettings,
  type Appearance,
  type NodeViewMode,
  type ResolvedThemeSettings,
} from "@/utils/themeSettings";
import {
  getDefaultOverviewRatingLabelText,
  OVERVIEW_RATING_STYLES,
  type OverviewRatingKind,
  type OverviewRatingStyle,
} from "@/utils/overviewRating";
import {
  HOME_SORT_FIELDS,
  HOME_SORT_FIELD_LABELS,
  type HomeSortDirection,
  type HomeSortField,
} from "@/utils/homeSort";

const APPEARANCE_OPTIONS = [
  { value: "light", label: "浅色", icon: Sun },
  { value: "system", label: "跟随系统", icon: SunMoon },
  { value: "dark", label: "深色", icon: Moon },
] as const;
const NODE_VIEW_MODE_OPTIONS = [
  { value: "large", label: "大卡片", icon: LayoutGrid },
  { value: "compact", label: "小卡片", icon: Rows3 },
] as const;
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

const OVERVIEW_RATING_LABEL_FIELDS: Array<{
  key: OverviewRatingKind;
  title: string;
}> = [
  { key: "traffic", title: "累计流量评级名称" },
  { key: "bandwidth", title: "实时带宽评级名称" },
  { key: "asset", title: "资产评级名称" },
];

function sortTasks(tasks: PingTask[]) {
  return [...tasks].sort((left, right) => {
    if (left.weight !== right.weight) return left.weight - right.weight;
    if (left.id !== right.id) return left.id - right.id;
    return left.name.localeCompare(right.name);
  });
}

function sortClients(clients: AdminClient[]) {
  return [...clients].sort((left, right) => {
    if (left.weight !== right.weight) return left.weight - right.weight;
    return left.name.localeCompare(right.name);
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

function pickManagedThemeSettings(settings: ResolvedThemeSettings): ThemeSettings {
  return {
    defaultAppearance: settings.defaultAppearance,
    desktopNodeViewMode: settings.desktopNodeViewMode,
    mobileNodeViewMode: settings.mobileNodeViewMode,
    homepagePingBindings: settings.homepagePingBindings,
    showHomeOverview: settings.showHomeOverview,
    showGroupTabs: settings.showGroupTabs,
    homeGroupOrder: settings.homeGroupOrder,
    enableHomeSort: settings.enableHomeSort,
    homeSortField: settings.homeSortField,
    homeSortDirection: settings.homeSortDirection,
    showCostSummary: settings.showCostSummary,
    showCostSummaryFloatingButton: settings.showCostSummaryFloatingButton,
    showOverviewRatings: settings.showOverviewRatings,
    overviewRatingStyle: settings.overviewRatingStyle,
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
    hiddenNodes: settings.hiddenNodes,
    costIgnoredNodes: settings.costIgnoredNodes,
    costRateApiUrl: settings.costRateApiUrl,
    backgroundImage: settings.backgroundImage,
    backgroundImageMobile: settings.backgroundImageMobile,
    backgroundAlignment: settings.backgroundAlignment,
    surfaceOpacity: settings.surfaceOpacity,
  };
}

function managedSettingsSignature(settings: ThemeSettings & Record<string, unknown>) {
  return JSON.stringify(pickManagedThemeSettings(normalizeThemeSettings(settings)));
}

export function ThemeManage() {
  const { data: config, isLoading: configLoading } = usePublicConfig();
  const [draftAppearance, setDraftAppearance] = useState<Appearance>("system");
  const [draftDesktopNodeViewMode, setDraftDesktopNodeViewMode] =
    useState<NodeViewMode>("large");
  const [draftMobileNodeViewMode, setDraftMobileNodeViewMode] =
    useState<NodeViewMode>("compact");
  const [draftBindings, setDraftBindings] = useState<HomepagePingTaskBindings>({});
  const [draftShowHomeOverview, setDraftShowHomeOverview] = useState(true);
  const [draftShowGroupTabs, setDraftShowGroupTabs] = useState(true);
  const [draftHomeGroupOrder, setDraftHomeGroupOrder] = useState<string[]>([]);
  const [draftEnableHomeSort, setDraftEnableHomeSort] = useState(true);
  const [draftHomeSortField, setDraftHomeSortField] = useState<HomeSortField>("default");
  const [draftHomeSortDirection, setDraftHomeSortDirection] = useState<HomeSortDirection>("asc");
  const [draftShowCostSummary, setDraftShowCostSummary] = useState(true);
  const [draftShowCostSummaryFloatingButton, setDraftShowCostSummaryFloatingButton] =
    useState(true);
  const [draftShowOverviewRatings, setDraftShowOverviewRatings] = useState(true);
  const [draftOverviewRatingStyle, setDraftOverviewRatingStyle] =
    useState<OverviewRatingStyle>("plain");
  const [draftShowTrafficRating, setDraftShowTrafficRating] = useState(true);
  const [draftShowBandwidthRating, setDraftShowBandwidthRating] = useState(true);
  const [draftShowAssetRating, setDraftShowAssetRating] = useState(true);
  const [draftRatingLabels, setDraftRatingLabels] = useState<Record<OverviewRatingKind, string>>({
    traffic: "",
    bandwidth: "",
    asset: "",
  });
  const [draftCompactShowTrafficTotal, setDraftCompactShowTrafficTotal] = useState(true);
  const [draftCompactShowBilling, setDraftCompactShowBilling] = useState(true);
  const [draftCompactShowUptime, setDraftCompactShowUptime] = useState(true);
  const [draftShowConnections, setDraftShowConnections] = useState(false);
  const [draftHiddenNodesText, setDraftHiddenNodesText] = useState("");
  const [draftCostIgnoredText, setDraftCostIgnoredText] = useState("");
  const [draftCostRateApiUrl, setDraftCostRateApiUrl] = useState(
    DEFAULT_THEME_SETTINGS.costRateApiUrl,
  );
  const [draftBackgroundImage, setDraftBackgroundImage] = useState("");
  const [draftBackgroundImageMobile, setDraftBackgroundImageMobile] = useState("");
  const [draftBackgroundAlignment, setDraftBackgroundAlignment] = useState(
    DEFAULT_THEME_SETTINGS.backgroundAlignment,
  );
  const [draftSurfaceOpacity, setDraftSurfaceOpacity] = useState(
    DEFAULT_THEME_SETTINGS.surfaceOpacity,
  );
  const [expandedTaskId, setExpandedTaskId] = useState<number | null>(null);
  const [taskSearch, setTaskSearch] = useState("");
  const [nodeSearch, setNodeSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accessRevoked, setAccessRevoked] = useState(false);

  const {
    data: pingTasks,
    isLoading: tasksLoading,
    error: tasksError,
  } = useQuery({
    queryKey: ["admin", "ping-tasks"],
    queryFn: getAdminPingTasks,
    staleTime: 30_000,
    retry: false,
  });
  const {
    data: adminClients,
    isLoading: clientsLoading,
    error: clientsError,
  } = useQuery({
    queryKey: ["admin", "clients"],
    queryFn: getAdminClients,
    staleTime: 30_000,
    retry: false,
  });

  const sourceThemeSettings = useMemo(
    () => normalizeThemeSettings(config?.theme_settings),
    [config?.theme_settings],
  );
  // 服务端设置的内容签名。React Query 每次 ["public"] refetch(聚焦、过期、失效)都返回
  // 新的 `config` 对象,即使字节完全一样,每个 `source*` 值也会是新身份。用这个签名作为
  // reseed 的判断依据,并记录上次实际应用的值,这样内容相同的 refetch 不会冲掉未保存的草稿,
  // 而服务端数据真的变了时仍会重新 seed。
  const sourceSignature = useMemo(
    () => JSON.stringify(pickManagedThemeSettings(sourceThemeSettings)),
    [sourceThemeSettings],
  );
  const lastSeededSignatureRef = useRef<string | null>(null);

  // 把服务端设置灌入草稿字段的唯一出口,reseed effect 和重置按钮都走它,避免两边逻辑漂移。
  const seedDrafts = useCallback((next: ResolvedThemeSettings) => {
    setDraftAppearance(next.defaultAppearance);
    setDraftDesktopNodeViewMode(next.desktopNodeViewMode);
    setDraftMobileNodeViewMode(next.mobileNodeViewMode);
    setDraftBindings(next.homepagePingBindings);
    setDraftShowHomeOverview(next.showHomeOverview);
    setDraftShowGroupTabs(next.showGroupTabs);
    setDraftHomeGroupOrder(next.homeGroupOrder);
    setDraftEnableHomeSort(next.enableHomeSort);
    setDraftHomeSortField(next.homeSortField);
    setDraftHomeSortDirection(next.homeSortDirection);
    setDraftShowCostSummary(next.showCostSummary);
    setDraftShowCostSummaryFloatingButton(next.showCostSummaryFloatingButton);
    setDraftShowOverviewRatings(next.showOverviewRatings);
    setDraftOverviewRatingStyle(next.overviewRatingStyle);
    setDraftShowTrafficRating(next.showTrafficRating);
    setDraftShowBandwidthRating(next.showBandwidthRating);
    setDraftShowAssetRating(next.showAssetRating);
    setDraftRatingLabels({
      traffic: next.trafficRatingLabels,
      bandwidth: next.bandwidthRatingLabels,
      asset: next.assetRatingLabels,
    });
    setDraftCompactShowTrafficTotal(next.compactShowTrafficTotal);
    setDraftCompactShowBilling(next.compactShowBilling);
    setDraftCompactShowUptime(next.compactShowUptime);
    setDraftShowConnections(next.showConnections);
    setDraftHiddenNodesText(next.hiddenNodes.join("\n"));
    setDraftCostIgnoredText(next.costIgnoredNodes.join("\n"));
    setDraftCostRateApiUrl(next.costRateApiUrl);
    setDraftBackgroundImage(next.backgroundImage);
    setDraftBackgroundImageMobile(next.backgroundImageMobile);
    setDraftBackgroundAlignment(next.backgroundAlignment);
    setDraftSurfaceOpacity(next.surfaceOpacity);
  }, []);

  useEffect(() => {
    if (!config) return;
    if (lastSeededSignatureRef.current === sourceSignature) return;
    lastSeededSignatureRef.current = sourceSignature;
    seedDrafts(sourceThemeSettings);
  }, [config, sourceSignature, sourceThemeSettings, seedDrafts]);

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
    () => sortHomeGroupOptions(availableGroups, draftHomeGroupOrder),
    [availableGroups, draftHomeGroupOrder],
  );
  const moveGroup = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= orderedDraftGroups.length) return;
    const next = [...orderedDraftGroups];
    [next[index], next[target]] = [next[target], next[index]];
    setDraftHomeGroupOrder(next);
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

  const visibleClients = useMemo(() => {
    const keyword = nodeSearch.trim().toLowerCase();
    if (!keyword) return sortedClients;
    return sortedClients.filter((client) => {
      const group = String(client.group || "").toLowerCase();
      const region = String(client.region || "").toLowerCase();
      return (
        client.name.toLowerCase().includes(keyword) ||
        client.uuid.toLowerCase().includes(keyword) ||
        group.includes(keyword) ||
        region.includes(keyword)
      );
    });
  }, [nodeSearch, sortedClients]);

  const draftHiddenNodes = useMemo(
    () => normalizeNodeIdentityList(draftHiddenNodesText),
    [draftHiddenNodesText],
  );
  const draftCostIgnoredNodes = useMemo(
    () => normalizeCostIgnoredNodes(draftCostIgnoredText),
    [draftCostIgnoredText],
  );
  const normalizedDraftCostRateApiUrl = normalizeCostRateApiUrl(draftCostRateApiUrl);
  const draftCostRateApiUrlInvalid =
    draftCostRateApiUrl.trim() !== "" && !isCostRateApiUrlValid(draftCostRateApiUrl.trim());

  // 由当前草稿拼出的设置 payload,保存请求和 dirty 判断都用它。新增一项设置只需改这个对象
  // (和 seedDrafts),不必同时改六处。
  const draftThemeSettings = useMemo<ThemeSettings>(
    () => ({
      defaultAppearance: draftAppearance,
      desktopNodeViewMode: draftDesktopNodeViewMode,
      mobileNodeViewMode: draftMobileNodeViewMode,
      homepagePingBindings: pruneBindings(draftBindings),
      showHomeOverview: draftShowHomeOverview,
      showGroupTabs: draftShowGroupTabs,
      homeGroupOrder: normalizeHomeGroupOrder(draftHomeGroupOrder),
      enableHomeSort: draftEnableHomeSort,
      homeSortField: draftHomeSortField,
      homeSortDirection: draftHomeSortDirection,
      showCostSummary: draftShowCostSummary,
      showCostSummaryFloatingButton: draftShowCostSummaryFloatingButton,
      showOverviewRatings: draftShowOverviewRatings,
      overviewRatingStyle: draftOverviewRatingStyle,
      showTrafficRating: draftShowTrafficRating,
      showBandwidthRating: draftShowBandwidthRating,
      showAssetRating: draftShowAssetRating,
      trafficRatingLabels: draftRatingLabels.traffic,
      bandwidthRatingLabels: draftRatingLabels.bandwidth,
      assetRatingLabels: draftRatingLabels.asset,
      compactShowTrafficTotal: draftCompactShowTrafficTotal,
      compactShowBilling: draftCompactShowBilling,
      compactShowUptime: draftCompactShowUptime,
      showConnections: draftShowConnections,
      hiddenNodes: draftHiddenNodes,
      costIgnoredNodes: draftCostIgnoredNodes,
      costRateApiUrl: normalizedDraftCostRateApiUrl,
      backgroundImage: normalizeBackgroundUrl(draftBackgroundImage),
      backgroundImageMobile: normalizeBackgroundUrl(draftBackgroundImageMobile),
      backgroundAlignment: normalizeBackgroundAlignment(draftBackgroundAlignment),
      surfaceOpacity: draftSurfaceOpacity,
    }),
    [
      draftAppearance,
      draftDesktopNodeViewMode,
      draftMobileNodeViewMode,
      draftBindings,
      draftShowHomeOverview,
      draftShowGroupTabs,
      draftHomeGroupOrder,
      draftEnableHomeSort,
      draftHomeSortField,
      draftHomeSortDirection,
      draftShowCostSummary,
      draftShowCostSummaryFloatingButton,
      draftShowOverviewRatings,
      draftOverviewRatingStyle,
      draftShowTrafficRating,
      draftShowBandwidthRating,
      draftShowAssetRating,
      draftRatingLabels,
      draftCompactShowTrafficTotal,
      draftCompactShowBilling,
      draftCompactShowUptime,
      draftShowConnections,
      draftHiddenNodes,
      draftCostIgnoredNodes,
      normalizedDraftCostRateApiUrl,
      draftBackgroundImage,
      draftBackgroundImageMobile,
      draftBackgroundAlignment,
      draftSurfaceOpacity,
    ],
  );

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
    draftCostRateApiUrl.trim() !== sourceThemeSettings.costRateApiUrl;
  const isDirty = draftSignature !== sourceSignature || costRateApiUrlDirty;

  // 用户重新编辑后清掉「已保存」提示,避免过期的成功提示和 dirty 表单并存。
  useEffect(() => {
    if (isDirty) setMessage(null);
  }, [isDirty]);

  const assignedNodeCount = useMemo(
    () => Object.values(draftBindings).reduce((total, clients) => total + clients.length, 0),
    [draftBindings],
  );

  // 每个 client 归属哪个 task 的反查,只在 draftBindings 变化时重建。与「全选可用」reducer
  // 共用 invertBindings() 避免推导漂移,并把可选节点过滤保持在 O(tasks × clients),
  // 而不是每个 client 都重扫一遍 bindings。
  const assignedTaskByClientUuid = useMemo(
    () => invertBindings(draftBindings),
    [draftBindings],
  );

  const handleSave = async () => {
    if (!config?.theme) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const baseSettings: ThemeSettings & Record<string, unknown> = {
        ...(config.theme_settings ?? {}),
      };
      delete baseSettings.homepagePingTask;
      const nextSettings: ThemeSettings & Record<string, unknown> = {
        ...baseSettings,
        ...draftThemeSettings,
      };
      await saveThemeSettings(config.theme, nextSettings);
      await queryClient.invalidateQueries({ queryKey: ["public"] });
      setMessage("主题设置已保存");
    } catch (saveError) {
      if (
        saveError instanceof ApiRequestError &&
        (saveError.status === 401 || saveError.status === 403)
      ) {
        setAccessRevoked(true);
        return;
      }
      setError(saveError instanceof Error ? saveError.message : "保存失败");
    } finally {
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
    setDraftRatingLabels((prev) => ({ ...prev, [kind]: value }));
  };
  const draftBgAlignment = parseBackgroundAlignment(draftBackgroundAlignment);
  const setBgSize = (size: BackgroundSize) =>
    setDraftBackgroundAlignment(`${size},${draftBgAlignment.position}`);
  const setBgPosition = (position: BackgroundPosition) =>
    setDraftBackgroundAlignment(`${draftBgAlignment.size},${position}`);
  const hasBackgroundImage = Boolean(
    normalizeBackgroundUrl(draftBackgroundImage) ||
      normalizeBackgroundUrl(draftBackgroundImageMobile),
  );

  return (
    <div className="flex flex-col gap-5 py-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
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
            disabled={!isDirty || saving || draftCostRateApiUrlInvalid}
            className="theme-manage-button is-primary"
          >
            {saving ? <Spinner size={14} /> : <Save size={14} />}
            <span>{saving ? "保存中" : "保存设置"}</span>
          </button>
        </div>
      </div>

      <InstancePanel
        title="LuminaPlus 主题设置"
        description="集中调整 LuminaPlus 的展示偏好与首页延迟绑定；保存后会立即应用到当前站点。"
        aside={
          <div className="text-right text-[11px] text-[var(--text-tertiary)]">
            <div>主题: {config?.theme || "Komari-Theme-LuminaPlus"}</div>
            <div>已绑定首页 Ping 节点 {assignedNodeCount} / {sortedClients.length}</div>
          </div>
        }
      >
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
      </InstancePanel>

      <InstancePanel
        title="默认外观"
        description="为首次访问或尚未手动切换外观的用户设置默认显示模式；后续仍可在首页右上角按需切换。"
        aside={<LayoutTemplate size={16} />}
      >
        <div className="instance-segmented is-scrollable">
          {APPEARANCE_OPTIONS.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              data-active={draftAppearance === value ? "true" : "false"}
              aria-pressed={draftAppearance === value}
              onClick={() => setDraftAppearance(value)}
              className="inline-flex items-center justify-center gap-2"
            >
              <Icon size={14} />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </InstancePanel>

      <InstancePanel
        title="默认卡片视图"
        description="分别设置桌面端与移动端的默认卡片尺寸；首页右上角按钮只临时切换当前设备的显示。"
        aside={<LayoutGrid size={16} />}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div className="surface-inset flex flex-col gap-3 px-4 py-4">
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
                  data-active={draftDesktopNodeViewMode === value ? "true" : "false"}
                  aria-pressed={draftDesktopNodeViewMode === value}
                  onClick={() => setDraftDesktopNodeViewMode(value)}
                  className="inline-flex items-center justify-center gap-2"
                >
                  <Icon size={14} />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="surface-inset flex flex-col gap-3 px-4 py-4">
            <div>
              <div className="text-[13px] font-semibold text-[var(--text-primary)]">
                移动端默认
              </div>
              <div className="mt-1 text-[11px] text-[var(--text-tertiary)]">
                适用于宽度小于等于 720px 的手机或窄屏窗口。
              </div>
            </div>
            <div className="instance-segmented is-scrollable">
              {NODE_VIEW_MODE_OPTIONS.map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  data-active={draftMobileNodeViewMode === value ? "true" : "false"}
                  aria-pressed={draftMobileNodeViewMode === value}
                  onClick={() => setDraftMobileNodeViewMode(value)}
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
        title="背景与透明度"
        description="为站点设置自定义背景图，并调节卡片不透明度。背景图可分别为浅色 / 深色与桌面 / 移动端设置；卡片不透明度调低后会自动加上磨砂玻璃与可读性遮罩。"
        aside={<Wallpaper size={16} />}
      >
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="flex min-w-0 flex-col gap-2">
              <span className="text-[12px] font-medium text-[var(--text-secondary)]">
                桌面端背景图
              </span>
              <input
                value={draftBackgroundImage}
                onChange={(event) => setDraftBackgroundImage(event.target.value)}
                placeholder="https://example.com/bg.webp"
                className="surface-inset w-full px-3 py-2 text-[13px] outline-none"
              />
              <span className="text-[11px] text-[var(--text-tertiary)]">
                留空则不显示背景图。可用 <code>浅色图|深色图</code> 为两种外观分别设置。
              </span>
            </label>
            <label className="flex min-w-0 flex-col gap-2">
              <span className="text-[12px] font-medium text-[var(--text-secondary)]">
                移动端背景图
              </span>
              <input
                value={draftBackgroundImageMobile}
                onChange={(event) => setDraftBackgroundImageMobile(event.target.value)}
                placeholder="留空则沿用桌面端背景图"
                className="surface-inset w-full px-3 py-2 text-[13px] outline-none"
              />
              <span className="text-[11px] text-[var(--text-tertiary)]">
                屏宽 ≤ 720px 时生效；同样支持 <code>浅色图|深色图</code> 写法。
              </span>
            </label>
          </div>

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
                  value={draftSurfaceOpacity}
                  onChange={(event) => {
                    // Number("") === 0,没有这行的话清空输入框(想重新输入)会把值跳成 0。
                    if (event.target.value.trim() === "") return;
                    const next = Number(event.target.value);
                    if (!Number.isFinite(next)) return;
                    setDraftSurfaceOpacity(Math.min(100, Math.max(0, Math.round(next))));
                  }}
                  aria-label="卡片不透明度百分比"
                  className="surface-inset w-20 px-3 py-2 text-right text-[13px] tabular outline-none"
                />
                <span className="text-[13px] font-medium text-[var(--text-tertiary)]">%</span>
              </span>
            </div>
            <span className="text-[11px] leading-relaxed text-[var(--text-tertiary)]">
              输入 0–100 的整数。100 = 完全不透明（与默认主题一致），数值越低卡片越通透、越能透出背景图。
              {hasBackgroundImage
                ? " 低于 95 时会自动叠加磨砂玻璃与可读性遮罩，保证文字清晰。"
                : " 需先在上方设置背景图后才会生效。"}
            </span>
          </div>
        </div>
      </InstancePanel>

      <InstancePanel
        title="首页巡检"
        description="控制首页顶部总览、分组筛选和节点排序方式；适合节点较多时快速查看状态。"
        aside={<ListFilter size={16} />}
      >
        <div className="grid gap-3 md:grid-cols-3">
          <label className="surface-inset flex items-center justify-between gap-3 px-4 py-3">
            <span className="min-w-0">
              <span className="block text-[13px] font-medium text-[var(--text-primary)]">
                显示顶部总览
              </span>
              <span className="mt-1 block text-[11px] text-[var(--text-tertiary)]">
                展示时间、在线数、地区、流量和速率。
              </span>
            </span>
            <input
              type="checkbox"
              checked={draftShowHomeOverview}
              onChange={(event) => setDraftShowHomeOverview(event.target.checked)}
              className="h-4 w-4 shrink-0 accent-[var(--accent-500)]"
            />
          </label>
          <label className="surface-inset flex items-center justify-between gap-3 px-4 py-3">
            <span className="min-w-0">
              <span className="block text-[13px] font-medium text-[var(--text-primary)]">
                显示分组筛选
              </span>
              <span className="mt-1 block text-[11px] text-[var(--text-tertiary)]">
                根据后端节点分组生成首页 Tab。
              </span>
            </span>
            <input
              type="checkbox"
              checked={draftShowGroupTabs}
              onChange={(event) => setDraftShowGroupTabs(event.target.checked)}
              className="h-4 w-4 shrink-0 accent-[var(--accent-500)]"
            />
          </label>
          <label className="surface-inset flex items-center justify-between gap-3 px-4 py-3">
            <span className="min-w-0">
              <span className="block text-[13px] font-medium text-[var(--text-primary)]">
                启用排序切换
              </span>
              <span className="mt-1 block text-[11px] text-[var(--text-tertiary)]">
                首页显示排序控件，访客可临时切换排序方式（离线节点恒定置底）。
              </span>
            </span>
            <input
              type="checkbox"
              checked={draftEnableHomeSort}
              onChange={(event) => setDraftEnableHomeSort(event.target.checked)}
              className="h-4 w-4 shrink-0 accent-[var(--accent-500)]"
            />
          </label>
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
                  data-active={draftHomeSortField === field ? "true" : "false"}
                  aria-pressed={draftHomeSortField === field}
                  disabled={!draftEnableHomeSort}
                  onClick={() => setDraftHomeSortField(field)}
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
                data-active={draftHomeSortDirection === "asc" ? "true" : "false"}
                aria-pressed={draftHomeSortDirection === "asc"}
                disabled={!draftEnableHomeSort}
                onClick={() => setDraftHomeSortDirection("asc")}
              >
                升序
              </button>
              <button
                type="button"
                data-active={draftHomeSortDirection === "desc" ? "true" : "false"}
                aria-pressed={draftHomeSortDirection === "desc"}
                disabled={!draftEnableHomeSort}
                onClick={() => setDraftHomeSortDirection("desc")}
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
                checked={draftShowOverviewRatings}
                onChange={(event) => setDraftShowOverviewRatings(event.target.checked)}
                className="h-4 w-4 accent-[var(--accent-500)]"
              />
            </label>
          </div>

          <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
            <div className="flex flex-col gap-3">
              <div>
                <div className="mb-2 text-[12px] font-medium text-[var(--text-secondary)]">
                  评级风格
                </div>
                <div className="instance-segmented is-scrollable">
                  {OVERVIEW_RATING_STYLES.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      data-active={draftOverviewRatingStyle === option.value ? "true" : "false"}
                      aria-pressed={draftOverviewRatingStyle === option.value}
                      disabled={!draftShowOverviewRatings}
                      onClick={() => setDraftOverviewRatingStyle(option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <label className="flex items-center justify-between gap-2 rounded-[10px] border border-[var(--hairline)] px-3 py-2 text-[12px] text-[var(--text-secondary)]">
                  <span>累计流量</span>
                  <input
                    type="checkbox"
                    checked={draftShowTrafficRating}
                    disabled={!draftShowOverviewRatings}
                    onChange={(event) => setDraftShowTrafficRating(event.target.checked)}
                    className="h-4 w-4 accent-[var(--accent-500)]"
                  />
                </label>
                <label className="flex items-center justify-between gap-2 rounded-[10px] border border-[var(--hairline)] px-3 py-2 text-[12px] text-[var(--text-secondary)]">
                  <span>实时带宽</span>
                  <input
                    type="checkbox"
                    checked={draftShowBandwidthRating}
                    disabled={!draftShowOverviewRatings}
                    onChange={(event) => setDraftShowBandwidthRating(event.target.checked)}
                    className="h-4 w-4 accent-[var(--accent-500)]"
                  />
                </label>
                <label className="flex items-center justify-between gap-2 rounded-[10px] border border-[var(--hairline)] px-3 py-2 text-[12px] text-[var(--text-secondary)]">
                  <span>资产概览</span>
                  <input
                    type="checkbox"
                    checked={draftShowAssetRating}
                    disabled={!draftShowOverviewRatings}
                    onChange={(event) => setDraftShowAssetRating(event.target.checked)}
                    className="h-4 w-4 accent-[var(--accent-500)]"
                  />
                </label>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              {OVERVIEW_RATING_LABEL_FIELDS.map((field) => {
                const defaultLabel = getDefaultOverviewRatingLabelText(
                  field.key,
                  draftOverviewRatingStyle,
                );
                return (
                  <label key={field.key} className="flex min-w-0 flex-col gap-2">
                    <span className="text-[12px] font-medium text-[var(--text-secondary)]">
                      {field.title}
                    </span>
                    <input
                      value={draftRatingLabels[field.key]}
                      disabled={!draftShowOverviewRatings}
                      onChange={(event) => setRatingLabelDraft(field.key, event.target.value)}
                      placeholder={defaultLabel}
                      className="surface-inset w-full px-3 py-2 text-[13px] outline-none disabled:opacity-60"
                    />
                    <span className="text-[11px] text-[var(--text-tertiary)]">
                      例如: {defaultLabel}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        </div>
      </InstancePanel>

      <InstancePanel
        title="隐藏节点"
        description="在此填写的节点会从首页彻底移除：不显示卡片，也不计入在线数、累计流量、实时带宽与资产等所有统计。对所有访客生效，清空即可恢复。"
        aside={<EyeOff size={16} />}
      >
        <label className="flex min-w-0 flex-col gap-2">
          <span className="text-[12px] font-medium text-[var(--text-secondary)]">
            隐藏列表
          </span>
          <textarea
            value={draftHiddenNodesText}
            onChange={(event) => setDraftHiddenNodesText(event.target.value)}
            placeholder="每行一个节点名称 / UUID，也可以用逗号分隔"
            className="surface-inset min-h-[112px] w-full resize-y px-3 py-2 text-[13px] outline-none"
          />
          <span className="text-[11px] text-[var(--text-tertiary)]">
            已隐藏 {draftHiddenNodes.length} 个节点。按名称或 UUID 匹配，大小写不敏感。
          </span>
        </label>
      </InstancePanel>

      <InstancePanel
        title="小卡片显示项"
        description="控制小卡片中间信息块的密度；实时速率始终显示，其他两项可以按需隐藏。"
        aside={<Rows3 size={16} />}
      >
        <div className="grid gap-3 md:grid-cols-2">
          <label className="surface-inset flex items-center justify-between gap-3 px-4 py-3">
            <span className="min-w-0">
              <span className="block text-[13px] font-medium text-[var(--text-primary)]">
                显示累计流量
              </span>
              <span className="mt-1 block text-[11px] text-[var(--text-tertiary)]">
                展示出站与入站累计流量。
              </span>
            </span>
            <input
              type="checkbox"
              checked={draftCompactShowTrafficTotal}
              onChange={(event) => setDraftCompactShowTrafficTotal(event.target.checked)}
              className="h-4 w-4 shrink-0 accent-[var(--accent-500)]"
            />
          </label>
          <label className="surface-inset flex items-center justify-between gap-3 px-4 py-3">
            <span className="min-w-0">
              <span className="block text-[13px] font-medium text-[var(--text-primary)]">
                显示费用到期
              </span>
              <span className="mt-1 block text-[11px] text-[var(--text-tertiary)]">
                展示续费价格与剩余天数。
              </span>
            </span>
            <input
              type="checkbox"
              checked={draftCompactShowBilling}
              onChange={(event) => setDraftCompactShowBilling(event.target.checked)}
              className="h-4 w-4 shrink-0 accent-[var(--accent-500)]"
            />
          </label>
          <label className="surface-inset flex items-center justify-between gap-3 px-4 py-3">
            <span className="min-w-0">
              <span className="block text-[13px] font-medium text-[var(--text-primary)]">
                显示在线时间
              </span>
              <span className="mt-1 block text-[11px] text-[var(--text-tertiary)]">
                在小卡片流量栏右侧展示在线时长。默认开启。
              </span>
            </span>
            <input
              type="checkbox"
              checked={draftCompactShowUptime}
              onChange={(event) => setDraftCompactShowUptime(event.target.checked)}
              className="h-4 w-4 shrink-0 accent-[var(--accent-500)]"
            />
          </label>
          <label className="surface-inset flex items-center justify-between gap-3 px-4 py-3">
            <span className="min-w-0">
              <span className="block text-[13px] font-medium text-[var(--text-primary)]">
                显示连接数（TCP/UDP）
              </span>
              <span className="mt-1 block text-[11px] text-[var(--text-tertiary)]">
                在大卡片与小卡片展示实时 TCP / UDP 连接数；需被控端上报，未上报显示 0。默认关闭。
              </span>
            </span>
            <input
              type="checkbox"
              checked={draftShowConnections}
              onChange={(event) => setDraftShowConnections(event.target.checked)}
              className="h-4 w-4 shrink-0 accent-[var(--accent-500)]"
            />
          </label>
        </div>
      </InstancePanel>

      <InstancePanel
        title="服务器花费"
        description="首页花费统计会使用实时汇率计算年化总支出、月均支出与剩余价值；忽略列表中的节点不会计入费用。"
        aside={<CircleDollarSign size={16} />}
      >
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.8fr)]">
          <div className="flex flex-col gap-3">
            <label className="surface-inset flex items-center justify-between gap-3 px-4 py-3">
              <span className="min-w-0 text-[13px] font-medium text-[var(--text-primary)]">
                显示首页花费统计
              </span>
              <input
                type="checkbox"
                checked={draftShowCostSummary}
                onChange={(event) => setDraftShowCostSummary(event.target.checked)}
                className="h-4 w-4 shrink-0 accent-[var(--accent-500)]"
              />
            </label>
            <label className="surface-inset flex items-center justify-between gap-3 px-4 py-3">
              <span className="min-w-0">
                <span className="block text-[13px] font-medium text-[var(--text-primary)]">
                  显示资产悬浮按钮
                </span>
                <span className="mt-1 block text-[11px] text-[var(--text-tertiary)]">
                  关闭顶部总览时，仍可通过悬浮按钮打开资产详情。
                </span>
              </span>
              <input
                type="checkbox"
                checked={draftShowCostSummaryFloatingButton}
                onChange={(event) =>
                  setDraftShowCostSummaryFloatingButton(event.target.checked)
                }
                className="h-4 w-4 shrink-0 accent-[var(--accent-500)]"
              />
            </label>
            <label className="flex flex-col gap-2">
              <span className="text-[12px] font-medium text-[var(--text-secondary)]">
                实时汇率接口
              </span>
              <input
                value={draftCostRateApiUrl}
                onChange={(event) => setDraftCostRateApiUrl(event.target.value)}
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
              value={draftCostIgnoredText}
              onChange={(event) => setDraftCostIgnoredText(event.target.value)}
              placeholder="每行一个节点名称 / UUID，也可以用逗号分隔"
              className="surface-inset min-h-[112px] w-full resize-y px-3 py-2 text-[13px] outline-none"
            />
          </label>
        </div>
      </InstancePanel>

      <InstancePanel
        title="主页延迟检测"
        description={
          <>
            为首页延迟卡片指定对应的 Ping 任务与展示节点。每个节点只能归属一个任务；未分配的节点不会显示延迟。
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
            {tasksLoading || clientsLoading ? "载入中" : `${sortedTasks.length} 个任务`}
          </div>
        }
      >
        <div className="flex flex-col gap-4">
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
                {assignedNodeCount} / {sortedClients.length}
              </strong>
            </div>
          </div>

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
              const assigned = draftBindings[String(task.id)] ?? [];
              const assignedSummary = summarizeNodes(assigned, clientsById);
              const isExpanded = expandedTaskId === task.id;
              const selectableVisibleClients = visibleClients.filter((client) => {
                const assignedTaskId = assignedTaskByClientUuid.get(client.uuid);
                return !assignedTaskId || assignedTaskId === String(task.id);
              });
              const unselectedVisibleClients = selectableVisibleClients.filter(
                (client) => !assigned.includes(client.uuid),
              );
              const allVisibleSelectableAssigned =
                selectableVisibleClients.length > 0 && unselectedVisibleClients.length === 0;
              return (
                <section key={task.id} className="surface-inset px-4 py-4">
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
                      <p
                        className="mt-2 text-[12px] text-[var(--text-tertiary)]"
                        title={assignedSummary}
                      >
                        {assignedSummary}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      {isExpanded && (
                        <button
                          type="button"
                          disabled={
                            selectableVisibleClients.length === 0 || allVisibleSelectableAssigned
                          }
                          onClick={() => {
                            setDraftBindings((prev) =>
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
                            setDraftBindings((prev) => {
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
                        aria-expanded={isExpanded}
                        onClick={() => {
                          setExpandedTaskId((current) => (current === task.id ? null : task.id));
                          setNodeSearch("");
                        }}
                        className="theme-manage-button is-compact"
                      >
                        {isExpanded ? "收起节点" : "编辑节点"}
                      </button>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="mt-4 border-t border-[var(--hairline)] pt-4">
                      <label className="surface-inset flex items-center gap-2 px-3 py-2">
                        <Search size={14} className="text-[var(--text-tertiary)]" />
                        <input
                          value={nodeSearch}
                          onChange={(event) => setNodeSearch(event.target.value)}
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
                                  setDraftBindings((prev) =>
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
            })}
        </div>
      </InstancePanel>
    </div>
  );
}
