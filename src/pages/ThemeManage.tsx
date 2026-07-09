import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  CircleDollarSign,
  EyeOff,
  Grid3x3,
  LayoutTemplate,
  LayoutGrid,
  List,
  ListFilter,
  Moon,
  PanelTop,
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
  getNodes,
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
  calculateCostSummary,
  formatCnyMoney,
  getExchangeRates,
  isCostRateApiUrlValid,
  normalizeCostIgnoredNodes,
  normalizeCostPremiums,
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
  type ResolvedThemeSettings,
} from "@/utils/themeSettings";
import {
  getDefaultOverviewRatingLabelText,
  OVERVIEW_RATING_STYLES,
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
// 列表档仅桌面可用,移动端默认里不提供(见 useViewMode 的 MOBILE_VIEW_MODES)。
const MOBILE_VIEW_MODE_OPTIONS = NODE_VIEW_MODE_OPTIONS.filter((option) => option.value !== "list");
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

// 本页托管设置的键清单唯一来源:草稿类型(ThemeDraft)、seed(draftFromSettings)与内容签名
// 都从它派生。新增一项设置只需在这里加一行,再到 JSX 里接 patch()。
// 刻意不标注返回类型:让推断给出全字段必填的具体类型,ThemeDraft 才能安全地 Omit/扩展。
function pickManagedThemeSettings(settings: ResolvedThemeSettings) {
  return {
    defaultAppearance: settings.defaultAppearance,
    desktopNodeViewMode: settings.desktopNodeViewMode,
    mobileNodeViewMode: settings.mobileNodeViewMode,
    homepagePingBindings: settings.homepagePingBindings,
    fakePingForUnbound: settings.fakePingForUnbound,
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
    // 按键排序:costPremiums 的键序随编辑历史漂移(删掉再加回同一键会排到最后),而 dirty /
    // reseed 判断都走 JSON.stringify 签名——不排序会把"内容相同、键序不同"误判成有未保存改动。
    costPremiums: Object.fromEntries(
      Object.keys(settings.costPremiums)
        .sort()
        .map((uuid) => [uuid, settings.costPremiums[uuid]]),
    ),
    costRateApiUrl: settings.costRateApiUrl,
    enableBackgroundImage: settings.enableBackgroundImage,
    backgroundImage: settings.backgroundImage,
    backgroundImageMobile: settings.backgroundImageMobile,
    backgroundAlignment: settings.backgroundAlignment,
    surfaceOpacity: settings.surfaceOpacity,
    showSiteHeader: settings.showSiteHeader,
    siteHeaderLogo: settings.siteHeaderLogo,
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

export function ThemeManage() {
  const { data: config, isLoading: configLoading } = usePublicConfig();
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

  // 单字段更新收口,所有表单控件都走它。值未变时原样返回 prev,保留旧的独立 useState
  // 在同值 set 时不触发重渲染的行为。
  const patch = useCallback(
    <K extends keyof ThemeDraft>(key: K, value: ThemeDraft[K]) => {
      setDraft((prev) => (Object.is(prev[key], value) ? prev : { ...prev, [key]: value }));
    },
    [],
  );
  // 绑定关系的三个入口(勾选/全选/清空)都是基于前值的函数式更新,单独收口。
  const patchBindings = useCallback(
    (updater: (prev: HomepagePingTaskBindings) => HomepagePingTaskBindings) => {
      setDraft((prev) => ({
        ...prev,
        homepagePingBindings: updater(prev.homepagePingBindings),
      }));
    },
    [],
  );

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

  // 把服务端设置灌入草稿的唯一出口,reseed effect 和重置按钮都走它,避免两边逻辑漂移。
  const seedDrafts = useCallback((next: ResolvedThemeSettings) => {
    setDraft(draftFromSettings(next));
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

  const filteredPremiumClients = useMemo(() => {
    const keyword = premiumSearch.trim().toLowerCase();
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
  }, [premiumSearch, sortedClients]);

  // 溢价表格里"当前剩余价值"仅供参考,用已保存的汇率源/忽略名单算(不用草稿里还没保存的
  // 编辑),口径与资产统计面板完全一致(同一个 calculateCostSummary),但不叠加溢价本身。
  // 刻意用一次性 getNodes 查询而不是 useAllNodeMeta():后者会启动全局节点 store 的实时
  // 状态轮询(wsStore),设置页只需要静态 meta,不该为一列参考值挂一个常驻轮询。
  const { data: allMeta = [] } = useQuery({
    queryKey: ["theme-manage", "node-meta"],
    queryFn: getNodes,
    staleTime: 60_000,
    retry: 1,
  });
  const premiumRateQuery = useQuery({
    queryKey: ["cost-rates", sourceThemeSettings.costRateApiUrl],
    queryFn: () => getExchangeRates(sourceThemeSettings.costRateApiUrl),
    staleTime: 60 * 60 * 1000,
    enabled: allMeta.length > 0,
    retry: 1,
  });
  const premiumReferenceByUuid = useMemo(() => {
    const map = new Map<string, string>();
    if (!premiumRateQuery.data) return map;
    const summary = calculateCostSummary(
      allMeta,
      sourceThemeSettings.costIgnoredNodes,
      premiumRateQuery.data.rates,
    );
    for (const detail of summary.details) {
      map.set(detail.uuid, detail.counted ? formatCnyMoney(detail.remainingCny) : detail.note || "--");
    }
    return map;
  }, [allMeta, sourceThemeSettings.costIgnoredNodes, premiumRateQuery.data]);

  // 只统计非零溢价的节点数,给面板的 aside 摘要用。
  const premiumConfiguredCount = useMemo(
    () => Object.keys(draft.costPremiums).filter((uuid) => draft.costPremiums[uuid] !== 0).length,
    [draft.costPremiums],
  );

  const patchPremium = useCallback(
    (uuid: string, rawValue: string) => {
      setDraft((prev) => {
        const next = { ...prev.costPremiums };
        if (rawValue.trim() === "") {
          if (!(uuid in next)) return prev;
          delete next[uuid];
        } else {
          const amount = Number(rawValue);
          if (!Number.isFinite(amount)) return prev;
          if (Object.is(prev.costPremiums[uuid], amount)) return prev;
          next[uuid] = amount;
        }
        return { ...prev, costPremiums: next };
      });
    },
    [],
  );

  const draftHiddenNodes = useMemo(
    () => normalizeNodeIdentityList(draft.hiddenNodesText),
    [draft.hiddenNodesText],
  );
  const draftCostRateApiUrlInvalid =
    draft.costRateApiUrl.trim() !== "" && !isCostRateApiUrlValid(draft.costRateApiUrl.trim());

  // 由当前草稿拼出的设置 payload,保存请求和 dirty 判断都用它。草稿字段与设置同名,这里只做
  // 「编辑态 → 存储态」的换形与归一化;文本域(hiddenNodesText/costIgnoredText)和 ratingLabels
  // 解构出来换回存储字段,其余原样透传。
  const draftThemeSettings = useMemo<ThemeSettings>(() => {
    const { ratingLabels, hiddenNodesText, costIgnoredText, ...rest } = draft;
    return {
      ...rest,
      homepagePingBindings: pruneBindings(rest.homepagePingBindings),
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
      backgroundAlignment: normalizeBackgroundAlignment(rest.backgroundAlignment),
      siteHeaderLogo: normalizeBackgroundUrl(rest.siteHeaderLogo),
    };
  }, [draft]);

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
  const isDirty = draftSignature !== sourceSignature || costRateApiUrlDirty;

  // 用户重新编辑后清掉「已保存」提示,避免过期的成功提示和 dirty 表单并存。
  useEffect(() => {
    if (isDirty) setMessage(null);
  }, [isDirty]);

  const assignedNodeCount = useMemo(
    () =>
      Object.values(draft.homepagePingBindings).reduce(
        (total, clients) => total + clients.length,
        0,
      ),
    [draft.homepagePingBindings],
  );

  // 每个 client 归属哪个 task 的反查,只在绑定草稿变化时重建。与「全选可用」reducer
  // 共用 invertBindings() 避免推导漂移,并把可选节点过滤保持在 O(tasks × clients),
  // 而不是每个 client 都重扫一遍 bindings。
  const assignedTaskByClientUuid = useMemo(
    () => invertBindings(draft.homepagePingBindings),
    [draft.homepagePingBindings],
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
  const hasBackgroundImage =
    draft.enableBackgroundImage &&
    Boolean(
      normalizeBackgroundUrl(draft.backgroundImage) ||
        normalizeBackgroundUrl(draft.backgroundImageMobile),
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
        title="背景与透明度"
        description="为站点设置自定义背景图，并调节卡片不透明度。背景图可分别为浅色 / 深色与桌面 / 移动端设置；卡片不透明度调低后会自动叠加可读性遮罩。"
        aside={<Wallpaper size={16} />}
      >
        <div className="flex flex-col gap-4">
          <label className="surface-inset flex items-center justify-between gap-3 px-4 py-3">
            <span className="min-w-0">
              <span className="block text-[13px] font-medium text-[var(--text-primary)]">
                启用背景图
              </span>
              <span className="mt-1 block text-[11px] text-[var(--text-tertiary)]">
                关闭后不加载任何背景图（下方 URL 配置会保留），站点回到纯色主题；再次开启即恢复。
              </span>
            </span>
            <input
              type="checkbox"
              checked={draft.enableBackgroundImage}
              onChange={(event) => patch("enableBackgroundImage", event.target.checked)}
              className="h-4 w-4 shrink-0 accent-[var(--accent-500)]"
            />
          </label>
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
                留空则不显示背景图。可用 <code>浅色图|深色图</code> 为两种外观分别设置。
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
              输入 0–100 的整数。100 = 完全不透明（与默认主题一致），数值越低卡片越通透、越能透出背景图。
              {hasBackgroundImage
                ? " 低于 95 时会自动在背景图上叠加可读性遮罩，保证文字清晰；卡片本身保持纯半透明，各设备观感一致。"
                : " 需先在上方设置背景图后才会生效。"}
            </span>
          </div>
        </div>
      </InstancePanel>

      <InstancePanel
        title="顶部标题栏"
        description="在页面顶部展示站点 Logo 与名称，向下滚动时背景自动毛玻璃虚化。Logo 默认使用后台上传的站点图标；站点名称取自后台「站点名称」设置。"
        aside={<PanelTop size={16} />}
      >
        <div className="flex flex-col gap-4">
          <label className="surface-inset flex items-center justify-between gap-3 px-4 py-3">
            <span className="min-w-0">
              <span className="block text-[13px] font-medium text-[var(--text-primary)]">
                显示标题栏
              </span>
              <span className="mt-1 block text-[11px] text-[var(--text-tertiary)]">
                关闭后页面顶部不显示标题栏，站点回到无品牌栏的布局；再次开启即恢复。
              </span>
            </span>
            <input
              type="checkbox"
              checked={draft.showSiteHeader}
              onChange={(event) => patch("showSiteHeader", event.target.checked)}
              className="h-4 w-4 shrink-0 accent-[var(--accent-500)]"
            />
          </label>
          <label className="flex min-w-0 flex-col gap-2">
            <span className="text-[12px] font-medium text-[var(--text-secondary)]">
              自定义 Logo URL
            </span>
            <input
              value={draft.siteHeaderLogo}
              onChange={(event) => patch("siteHeaderLogo", event.target.value)}
              placeholder="留空则使用后台上传的站点图标"
              className="surface-inset w-full px-3 py-2 text-[13px] outline-none"
            />
            <span className="text-[11px] text-[var(--text-tertiary)]">
              填写图片地址可覆盖默认站点图标。图片加载失败时会回退显示站点名称首字。
            </span>
          </label>
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
              checked={draft.showHomeOverview}
              onChange={(event) => patch("showHomeOverview", event.target.checked)}
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
              checked={draft.showGroupTabs}
              onChange={(event) => patch("showGroupTabs", event.target.checked)}
              className="h-4 w-4 shrink-0 accent-[var(--accent-500)]"
            />
          </label>
          <label className="surface-inset flex items-center justify-between gap-3 px-4 py-3">
            <span className="min-w-0">
              <span className="block text-[13px] font-medium text-[var(--text-primary)]">
                显示地区筛选
              </span>
              <span className="mt-1 block text-[11px] text-[var(--text-tertiary)]">
                按节点地区生成国旗筛选栏，点击某地区只看该地区节点。
              </span>
            </span>
            <input
              type="checkbox"
              checked={draft.showRegionBar}
              onChange={(event) => patch("showRegionBar", event.target.checked)}
              className="h-4 w-4 shrink-0 accent-[var(--accent-500)]"
            />
          </label>
          <label className="surface-inset flex items-center justify-between gap-3 px-4 py-3">
            <span className="min-w-0">
              <span className="block text-[13px] font-medium text-[var(--text-primary)]">
                卡片显示分组
              </span>
              <span className="mt-1 block text-[11px] text-[var(--text-tertiary)]">
                关闭后卡片内不再显示节点分组名（不影响分组筛选栏与备注）。
              </span>
            </span>
            <input
              type="checkbox"
              checked={draft.showCardGroup}
              onChange={(event) => patch("showCardGroup", event.target.checked)}
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
              checked={draft.enableHomeSort}
              onChange={(event) => patch("enableHomeSort", event.target.checked)}
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
                      data-active={draft.overviewRatingStyle === option.value ? "true" : "false"}
                      aria-pressed={draft.overviewRatingStyle === option.value}
                      disabled={!draft.showOverviewRatings}
                      onClick={() => patch("overviewRatingStyle", option.value)}
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
                    checked={draft.showTrafficRating}
                    disabled={!draft.showOverviewRatings}
                    onChange={(event) => patch("showTrafficRating", event.target.checked)}
                    className="h-4 w-4 accent-[var(--accent-500)]"
                  />
                </label>
                <label className="flex items-center justify-between gap-2 rounded-[10px] border border-[var(--hairline)] px-3 py-2 text-[12px] text-[var(--text-secondary)]">
                  <span>实时带宽</span>
                  <input
                    type="checkbox"
                    checked={draft.showBandwidthRating}
                    disabled={!draft.showOverviewRatings}
                    onChange={(event) => patch("showBandwidthRating", event.target.checked)}
                    className="h-4 w-4 accent-[var(--accent-500)]"
                  />
                </label>
                <label className="flex items-center justify-between gap-2 rounded-[10px] border border-[var(--hairline)] px-3 py-2 text-[12px] text-[var(--text-secondary)]">
                  <span>资产概览</span>
                  <input
                    type="checkbox"
                    checked={draft.showAssetRating}
                    disabled={!draft.showOverviewRatings}
                    onChange={(event) => patch("showAssetRating", event.target.checked)}
                    className="h-4 w-4 accent-[var(--accent-500)]"
                  />
                </label>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              {OVERVIEW_RATING_LABEL_FIELDS.map((field) => {
                const defaultLabel = getDefaultOverviewRatingLabelText(
                  field.key,
                  draft.overviewRatingStyle,
                );
                return (
                  <label key={field.key} className="flex min-w-0 flex-col gap-2">
                    <span className="text-[12px] font-medium text-[var(--text-secondary)]">
                      {field.title}
                    </span>
                    <input
                      value={draft.ratingLabels[field.key]}
                      disabled={!draft.showOverviewRatings}
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
        title="小卡片显示项"
        description="控制小卡片中间信息块的密度；实时速率始终显示，其他项可以按需隐藏。"
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
              checked={draft.compactShowTrafficTotal}
              onChange={(event) => patch("compactShowTrafficTotal", event.target.checked)}
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
              checked={draft.compactShowBilling}
              onChange={(event) => patch("compactShowBilling", event.target.checked)}
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
              checked={draft.compactShowUptime}
              onChange={(event) => patch("compactShowUptime", event.target.checked)}
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
              checked={draft.showConnections}
              onChange={(event) => patch("showConnections", event.target.checked)}
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
                checked={draft.showCostSummary}
                onChange={(event) => patch("showCostSummary", event.target.checked)}
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
                checked={draft.showCostSummaryFloatingButton}
                onChange={(event) =>
                  patch("showCostSummaryFloatingButton", event.target.checked)
                }
                className="h-4 w-4 shrink-0 accent-[var(--accent-500)]"
              />
            </label>
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
        title="收购溢价"
        description="记录实际收购某台节点时多花/少花的钱（可正可负），只在资产统计的明细里展示，不参与剩余价值/年化/月均等任何汇总计算。留空即视为没有溢价。"
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
            <div className="surface-inset max-h-[320px] overflow-y-auto">
              {filteredPremiumClients.map((client) => (
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
                      {premiumRateQuery.isLoading
                        ? "计算中"
                        : premiumReferenceByUuid.get(client.uuid) ?? "--"}
                    </span>
                  </div>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="any"
                    value={draft.costPremiums[client.uuid] ?? ""}
                    onChange={(event) => patchPremium(client.uuid, event.target.value)}
                    placeholder="0"
                    aria-label={`${client.name} 的收购溢价`}
                    className="surface-inset w-24 shrink-0 px-2 py-1 text-right text-[13px] outline-none"
                  />
                </div>
              ))}
            </div>
          )}
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

          <label className="surface-inset flex items-center justify-between gap-3 px-4 py-3">
            <span className="min-w-0">
              <span className="block text-[13px] font-medium text-[var(--text-primary)]">
                未绑定节点显示模拟延迟
              </span>
              <span className="mt-1 block text-[11px] text-[var(--text-tertiary)]">
                未绑定 Ping 任务的在线节点在首页卡片显示前端生成的模拟数据（延迟 1-10ms、丢包
                0%），仅用于视觉统一，不代表真实网络质量；离线节点仍显示“未配置”。
              </span>
            </span>
            <input
              type="checkbox"
              checked={draft.fakePingForUnbound}
              onChange={(event) => patch("fakePingForUnbound", event.target.checked)}
              className="h-4 w-4 shrink-0 accent-[var(--accent-500)]"
            />
          </label>

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
              const assigned = draft.homepagePingBindings[String(task.id)] ?? [];
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
                            patchBindings((prev) =>
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
                            patchBindings((prev) => {
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
                                  patchBindings((prev) =>
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
