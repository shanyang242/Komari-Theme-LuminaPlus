import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  CircleDollarSign,
  EyeOff,
  LayoutTemplate,
  LayoutGrid,
  ListFilter,
  Moon,
  RefreshCw,
  Rows3,
  Save,
  SlidersHorizontal,
  Sparkles,
  Sun,
  SunMoon,
  Wallpaper,
} from "lucide-react";
import { InstancePanel } from "@/components/instance/InstancePanel";
import { PingNodeConfigPanel } from "@/components/theme/PingNodeConfigPanel";
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
  type BackgroundPosition,
  type BackgroundSize,
  normalizeBackgroundAlignment,
  normalizeBackgroundUrl,
  parseBackgroundAlignment,
} from "@/utils/background";
import {
  calculateCostPaybackMonths,
  calculateCostSummary,
  calculateCostPremiumAmount,
  calculateCostPremiumBasisAt,
  formatCnyMoney,
  formatCostPayback,
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
  normalizeHomepagePingNodeTaskIds,
  type HomepagePingNodeTaskIds,
} from "@/utils/pingTasks";
import {
  DEFAULT_THEME_SETTINGS,
  normalizeHomeHeaderVisibleSeconds,
  normalizeThemeSettings,
  type AmbientEffect,
  type ResolvedThemeSettings,
} from "@/utils/themeSettings";

const APPEARANCE_OPTIONS = [
  { value: "light", label: "浅色", icon: Sun },
  { value: "system", label: "跟随系统", icon: SunMoon },
  { value: "dark", label: "深色", icon: Moon },
] as const;
const NODE_VIEW_MODE_OPTIONS = [
  { value: "large", label: "大卡片", icon: LayoutGrid },
  { value: "compact", label: "小卡片", icon: Rows3 },
] as const;
const MOBILE_VIEW_MODE_OPTIONS = NODE_VIEW_MODE_OPTIONS;
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
  regularPriceCny?: number,
): CostPremiumEntry {
  return {
    amount,
    ...(paidCny != null ? { paidCny } : {}),
    ...(acquiredAt ? { acquiredAt } : {}),
    ...(regularPriceCny != null ? { regularPriceCny } : {}),
  };
}

function sortClients(clients: AdminClient[]) {
  return [...clients].sort((left, right) => {
    if (left.weight !== right.weight) return left.weight - right.weight;
    return left.name.localeCompare(right.name);
  });
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
    homepagePingNodeTaskIds: settings.homepagePingNodeTaskIds,
    fakePingForUnbound: settings.fakePingForUnbound,
    enableHomeHeaderAutoHide: settings.enableHomeHeaderAutoHide,
    homeHeaderVisibleSeconds: settings.homeHeaderVisibleSeconds,
    showHomeOverview: settings.showHomeOverview,
    showGroupTabs: settings.showGroupTabs,
    showRegionBar: settings.showRegionBar,
    showCardGroup: settings.showCardGroup,
    showCostsToGuests: settings.showCostsToGuests,
    showCostSummary: settings.showCostSummary,
    compactShowTrafficTotal: settings.compactShowTrafficTotal,
    compactShowBilling: settings.compactShowBilling,
    compactShowUptime: settings.compactShowUptime,
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
    enableAmbientEffect: settings.enableAmbientEffect,
    ambientEffect: settings.ambientEffect,
  };
}

function managedSettingsSignature(settings: ThemeSettings & Record<string, unknown>) {
  return JSON.stringify(pickManagedThemeSettings(normalizeThemeSettings(settings)));
}

type ManagedThemeSettings = ReturnType<typeof pickManagedThemeSettings>;

// 表单草稿:与托管设置同名同构，仅隐藏/忽略列表以多行文本编辑
// (提交时再归一化回数组)。其余字段直接透传,不维护第二份键清单。
type ThemeDraft = Omit<
  ManagedThemeSettings,
  | "hiddenNodes"
  | "costIgnoredNodes"
> & {
  hiddenNodesText: string;
  costIgnoredText: string;
};

// 服务端设置 → 表单草稿。reseed effect 和重置按钮都经 seedDrafts 走这里。
function draftFromSettings(settings: ResolvedThemeSettings): ThemeDraft {
  const {
    hiddenNodes,
    costIgnoredNodes,
    ...rest
  } = pickManagedThemeSettings(settings);
  return {
    ...rest,
    hiddenNodesText: hiddenNodes.join("\n"),
    costIgnoredText: costIgnoredNodes.join("\n"),
  };
}

type BooleanDraftKey = {
  [K in keyof ThemeDraft]: ThemeDraft[K] extends boolean ? K : never;
}[keyof ThemeDraft];

// 统一的开关行。memo + 稳定的 patch 引用:编辑无关字段的击键不再重渲这些行。
const ToggleRow = memo(function ToggleRow({
  field,
  title,
  checked,
  onPatch,
}: {
  field: BooleanDraftKey;
  title: string;
  checked: boolean;
  onPatch: (key: BooleanDraftKey, value: boolean) => void;
}) {
  return (
    <label className="surface-inset flex items-center justify-between gap-3 px-4 py-3">
      <span className="min-w-0 text-[13px] font-medium text-[var(--text-primary)]">{title}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onPatch(field, event.target.checked)}
        className="h-4 w-4 shrink-0 accent-[var(--accent-500)]"
      />
    </label>
  );
});

type PremiumDetail = ReturnType<typeof calculateCostSummary>["details"][number];

// 溢价录入列表。memo:编辑其他设置的击键不重渲整表——引用变化只来自
// costPremiums 切片与汇率加载态。
const PremiumList = memo(function PremiumList({
  clients,
  costPremiums,
  detailByUuid,
  rateLoading,
  acquiredAtMax,
  onPatchPaid,
  onPatchAcquiredAt,
  onPatchRegularPrice,
}: {
  clients: AdminClient[];
  costPremiums: ThemeDraft["costPremiums"];
  detailByUuid: Map<string, PremiumDetail>;
  rateLoading: boolean;
  acquiredAtMax: string;
  onPatchPaid: (uuid: string, rawValue: string) => void;
  onPatchAcquiredAt: (uuid: string, rawValue: string) => void;
  onPatchRegularPrice: (uuid: string, rawValue: string) => void;
}) {
  return (
    <div className="theme-premium-list surface-inset">
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
        const paybackMonths = entry && detail && canCompute
          ? calculateCostPaybackMonths(
              entry.amount,
              detail.priceCny,
              entry.regularPriceCny,
              detail.billingCycleDays,
            )
          : null;
        return (
          <div
            key={client.uuid}
            className="theme-premium-row"
          >
            <div className="theme-premium-node">
              <div className="theme-premium-name">
                <Flag region={client.region ?? ""} size={13} />
                <span title={client.name}>{client.name}</span>
              </div>
              <div className="theme-premium-summary">
                <span className="theme-premium-reference">
                  <span>剩余</span>
                  <strong>{referenceLabel}</strong>
                </span>
                {entry && (
                  <span
                    className="theme-premium-delta"
                    data-tone={
                      entry.amount > 0
                        ? "positive"
                        : entry.amount < 0
                          ? "negative"
                          : "neutral"
                    }
                  >
                    溢价 {formatSignedCny(entry.amount)}
                  </span>
                )}
                {entry?.regularPriceCny != null && canCompute && (
                  <span className="theme-premium-delta">
                    {formatCostPayback(paybackMonths, entry.amount, entry.regularPriceCny)}
                  </span>
                )}
              </div>
            </div>
            <div className="theme-premium-fields">
              <label className="theme-premium-field">
                <span className="theme-premium-field-label">收购价</span>
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
                className="theme-premium-input surface-inset"
              />
              </label>
              <label className="theme-premium-field">
                <span className="theme-premium-field-label">正价</span>
                <input
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min="0"
                  value={entry?.regularPriceCny ?? ""}
                  onChange={(event) => {
                    if (event.target.validity.badInput) return;
                    onPatchRegularPrice(client.uuid, event.target.value);
                  }}
                  placeholder="正价"
                  disabled={!entry || !canCompute}
                  aria-label={`${client.name} 的正价`}
                  className="theme-premium-input surface-inset"
                />
              </label>
              <label className="theme-premium-field is-date">
                <span className="theme-premium-field-label">收购日期</span>
                <input
                  type="date"
                  max={acquiredAtMax}
                  value={entry?.acquiredAt ?? ""}
                  onChange={(event) => onPatchAcquiredAt(client.uuid, event.target.value)}
                  // 与收购价同门槛:汇率/基准未就绪时 patchPremiumAcquiredAt 无法回算,
                  // 放开输入只会被静默丢弃(受控值弹回旧日期)。
                  disabled={!entry || !canCompute}
                  aria-label={`${client.name} 的收购日期`}
                  className="theme-premium-input surface-inset"
                />
              </label>
            </div>
          </div>
        );
      })}
    </div>
  );
});

// 弹窗开关留在这个小组件内，打开面板时不再让整个设置页跟着重渲染。
const PingNodeConfigControl = memo(function PingNodeConfigControl({
  clients,
  tasks,
  overrides,
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
  overrides: HomepagePingNodeTaskIds;
  configuredNodeCount: number;
  fakePingForUnbound: boolean;
  disabled: boolean;
  saving: boolean;
  saveDisabled: boolean;
  saveError: string | null;
  onChange: (next: HomepagePingNodeTaskIds) => void;
  onSave: () => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[12px] font-medium text-[var(--text-primary)]">
            <SlidersHorizontal size={14} />
            单网探测点
          </div>
          <p className="mt-1 text-[11px] text-[var(--text-tertiary)]">
            {configuredNodeCount} / {clients.length} 台实例使用手动或不绑定设置
          </p>
        </div>
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen(true)}
          className="theme-manage-button is-compact"
        >
          <SlidersHorizontal size={13} />
          配置实例探测点
        </button>
      </div>

      {open && (
        <PingNodeConfigPanel
          open
          clients={clients}
          tasks={tasks}
          overrides={overrides}
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
  const patchPingNodeTaskIds = useCallback(
    (next: HomepagePingNodeTaskIds) => {
      editVersionRef.current += 1;
      const normalized = normalizeHomepagePingNodeTaskIds(next);
      setDraft((prev) =>
        JSON.stringify(prev.homepagePingNodeTaskIds) === JSON.stringify(normalized)
          ? prev
          : { ...prev, homepagePingNodeTaskIds: normalized },
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
          current?.regularPriceCny,
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
        next[uuid] = buildPremiumEntry(
          amount,
          current.paidCny,
          acquiredAt,
          current.regularPriceCny,
        );
        return { ...prev, costPremiums: next };
      });
    },
    [premiumBasisAt],
  );

  const patchPremiumRegularPrice = useCallback((uuid: string, rawValue: string) => {
    editVersionRef.current += 1;
    setDraft((prev) => {
      const current = prev.costPremiums[uuid];
      if (!current) return prev;
      const regularPriceCny = rawValue.trim() === "" ? undefined : Number(rawValue);
      if (
        regularPriceCny != null &&
        (!Number.isFinite(regularPriceCny) || regularPriceCny < 0)
      ) {
        return prev;
      }
      if (Object.is(current.regularPriceCny, regularPriceCny)) return prev;
      return {
        ...prev,
        costPremiums: {
          ...prev.costPremiums,
          [uuid]: buildPremiumEntry(
            current.amount,
            current.paidCny,
            current.acquiredAt,
            regularPriceCny,
          ),
        },
      };
    });
  }, []);

  const draftCostRateApiUrlInvalid =
    draft.costRateApiUrl.trim() !== "" && !isCostRateApiUrlValid(draft.costRateApiUrl.trim());

  // 由当前草稿拼出的设置 payload,保存请求和 dirty 判断都用它。草稿字段与设置同名,这里只做
  // 「编辑态 → 存储态」的换形与归一化;文本域解构出来换回存储字段。
  const draftThemeSettings = useMemo<ThemeSettings>(() => {
    const { hiddenNodesText, costIgnoredText, ...rest } = draft;
    return {
      ...rest,
      homepagePingNodeTaskIds: normalizeHomepagePingNodeTaskIds(
        rest.homepagePingNodeTaskIds,
      ),
      hiddenNodes: normalizeNodeIdentityList(hiddenNodesText),
      costIgnoredNodes: normalizeCostIgnoredNodes(costIgnoredText),
      costPremiums: normalizeCostPremiums(rest.costPremiums),
      costRateApiUrl: normalizeCostRateApiUrl(rest.costRateApiUrl),
      backgroundImage: normalizeBackgroundUrl(rest.backgroundImage),
      backgroundImageMobile: normalizeBackgroundUrl(rest.backgroundImageMobile),
      backgroundAlignment: normalizeBackgroundAlignment(rest.backgroundAlignment),
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

  // 服务端设置真正变化时灌入草稿。首次灌入之后,只要表单有未保存编辑(含保存中)就跳过,
  // 避免 refetch / 其他端保存的回流静默覆盖用户草稿。
  useEffect(() => {
    if (!config) return;
    if (lastSeededSignatureRef.current === sourceSignature) return;
    if (lastSeededSignatureRef.current !== null && isDirty) return;
    lastSeededSignatureRef.current = sourceSignature;
    seedDrafts(sourceThemeSettings);
  }, [config, isDirty, sourceSignature, sourceThemeSettings, seedDrafts]);

  const pingConfiguredNodeCount = useMemo(
    () =>
      sortedClients.filter((client) =>
        Object.prototype.hasOwnProperty.call(draft.homepagePingNodeTaskIds, client.uuid),
      ).length,
    [draft.homepagePingNodeTaskIds, sortedClients],
  );

  const handleSave = async (): Promise<boolean> => {
    if (
      !config?.theme ||
      savingDraftRef.current ||
      draftCostRateApiUrlInvalid
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
      for (const key of [
        "homepagePingTask", "homepagePingBindings",
        "enableHomepageMultiPing", "homepageMultiPingTaskIds", "homepageMultiPingNodeTaskIds",
        "enableHomeSort", "homeSortField", "homeSortDirection",
        "homeGroupOrder",
        "showOverviewRatings", "showTrafficRating", "showBandwidthRating", "showAssetRating",
        "trafficRatingLabels", "bandwidthRatingLabels", "assetRatingLabels",
        "showConnections", "showTodayTrafficPopover",
        "backgroundMediaType", "backgroundVideo", "backgroundVideoDark",
        "showCostSummaryFloatingButton",
      ]) {
        delete nextSettings[key];
      }
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
  const draftBgAlignment = parseBackgroundAlignment(draft.backgroundAlignment);
  const setBgSize = (size: BackgroundSize) =>
    patch("backgroundAlignment", `${size},${draftBgAlignment.position}`);
  const setBgPosition = (position: BackgroundPosition) =>
    patch("backgroundAlignment", `${draftBgAlignment.size},${position}`);
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
                draftCostRateApiUrlInvalid
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
          </div>
          <dl className="theme-masthead-meta">
            <div>
              <dt>主题</dt>
              <dd>{config?.theme || "Komari-Theme-LuminaPlus"}</dd>
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
        kicker={<><span className="instance-panel-kicker-num">01</span>外观与视图</>}
        title="默认外观与卡片视图"
        aside={<LayoutTemplate size={16} />}
      >
        <div className="grid gap-4 lg:grid-cols-3">
          <section className="surface-inset flex min-w-0 flex-col gap-3 px-4 py-4">
            <div className="text-[13px] font-semibold text-[var(--text-primary)]">
              默认外观
            </div>
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
          </section>
          <section className="surface-inset flex min-w-0 flex-col gap-3 px-4 py-4">
            <div className="text-[13px] font-semibold text-[var(--text-primary)]">
              桌面端默认
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
          </section>
          <section className="surface-inset flex min-w-0 flex-col gap-3 px-4 py-4">
            <div className="text-[13px] font-semibold text-[var(--text-primary)]">
              移动端默认
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
          </section>
        </div>
      </InstancePanel>

      <InstancePanel
        kicker={<><span className="instance-panel-kicker-num">02</span>背景</>}
        title="背景与透明度"
        aside={<Wallpaper size={16} />}
      >
        <div className="flex flex-col gap-4">
          <ToggleRow
            field="enableBackgroundImage"
            title="启用自定义背景"
            checked={draft.enableBackgroundImage}
            onPatch={patch}
          />

          <div className="grid gap-3 md:grid-cols-2">
            <ToggleRow
              field="enableAmbientEffect"
              title="启用背景动效"
              checked={draft.enableAmbientEffect}
              onPatch={patch}
            />

            <label className="surface-inset flex min-w-0 flex-col justify-center gap-2 px-4 py-3">
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
            </label>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="flex min-w-0 flex-col gap-2">
              <span className="text-[12px] font-medium text-[var(--text-secondary)]">
                桌面端背景图
              </span>
              <input
                value={draft.backgroundImage}
                onChange={(event) => patch("backgroundImage", event.target.value)}
                className="surface-inset w-full px-3 py-2 text-[13px] outline-none"
              />
            </label>
            <label className="flex min-w-0 flex-col gap-2">
              <span className="text-[12px] font-medium text-[var(--text-secondary)]">
                移动端背景图
              </span>
              <input
                value={draft.backgroundImageMobile}
                onChange={(event) => patch("backgroundImageMobile", event.target.value)}
                className="surface-inset w-full px-3 py-2 text-[13px] outline-none"
              />
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
          </div>
        </div>
      </InstancePanel>

      <InstancePanel
        kicker={<><span className="instance-panel-kicker-num">03</span>首页</>}
        title="首页巡检"
        aside={<ListFilter size={16} />}
      >
        <div className="theme-home-control-grid grid gap-3 md:grid-cols-3">
          <ToggleRow
            field="enableHomeHeaderAutoHide"
            title="定时隐藏顶部信息"
            checked={draft.enableHomeHeaderAutoHide}
            onPatch={patch}
          />
          <div className="surface-inset flex items-center justify-between gap-3 px-4 py-3">
            <span className="text-[13px] font-medium text-[var(--text-primary)]">显示时长</span>
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
                className="theme-home-control-input surface-inset w-20 text-right text-[13px] tabular outline-none disabled:opacity-45"
              />
              <span className="text-[13px] font-medium text-[var(--text-tertiary)]">秒</span>
            </span>
          </div>
          <ToggleRow
            field="showHomeOverview"
            title="显示顶部总览"
            checked={draft.showHomeOverview}
            onPatch={patch}
          />
          <ToggleRow
            field="showGroupTabs"
            title="显示分组筛选"
            checked={draft.showGroupTabs}
            onPatch={patch}
          />
          <ToggleRow
            field="showRegionBar"
            title="显示地区筛选"
            checked={draft.showRegionBar}
            onPatch={patch}
          />
          <ToggleRow
            field="showCardGroup"
            title="卡片显示分组"
            checked={draft.showCardGroup}
            onPatch={patch}
          />
          <ToggleRow
            field="hideAdminEntryWhenLoggedOut"
            title="未登录时隐藏后台入口"
            checked={draft.hideAdminEntryWhenLoggedOut}
            onPatch={patch}
          />
        </div>

      </InstancePanel>

      <InstancePanel
        kicker={<><span className="instance-panel-kicker-num">04</span>隐藏</>}
        title="隐藏节点"
        aside={<EyeOff size={16} />}
      >
        <label className="flex min-w-0 flex-col gap-2">
          <span className="text-[12px] font-medium text-[var(--text-secondary)]">
            隐藏列表
          </span>
          <textarea
            value={draft.hiddenNodesText}
            onChange={(event) => patch("hiddenNodesText", event.target.value)}
            className="surface-inset min-h-[112px] w-full resize-y px-3 py-2 text-[13px] outline-none"
          />
        </label>
      </InstancePanel>

      <InstancePanel
        kicker={<><span className="instance-panel-kicker-num">05</span>卡片</>}
        title="卡片显示项"
        aside={<Rows3 size={16} />}
      >
        <div className="mt-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="text-[13px] font-medium text-[var(--text-primary)]">小卡片专属</span>
          </div>
          <div className="mt-2 grid gap-3 md:grid-cols-2">
            <ToggleRow
              field="compactShowTrafficTotal"
              title="显示累计流量"
              checked={draft.compactShowTrafficTotal}
              onPatch={patch}
            />
            <ToggleRow
              field="compactShowBilling"
              title="显示费用到期"
              checked={draft.compactShowBilling}
              onPatch={patch}
            />
            <ToggleRow
              field="compactShowUptime"
              title="显示在线时间"
              checked={draft.compactShowUptime}
              onPatch={patch}
            />
          </div>
        </div>
      </InstancePanel>

      <InstancePanel
        kicker={<><span className="instance-panel-kicker-num">06</span>花费</>}
        title="服务器花费"
        aside={<CircleDollarSign size={16} />}
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="flex flex-col gap-3">
            <ToggleRow
              field="showCostsToGuests"
              title="向未登录访客公开费用"
              checked={draft.showCostsToGuests}
              onPatch={patch}
            />
            <ToggleRow
              field="showCostSummary"
              title="显示资产页入口按钮"
              checked={draft.showCostSummary}
              onPatch={patch}
            />
            <label className="surface-inset flex flex-col gap-2 px-4 py-3">
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
          <label className="relative flex min-w-0 self-stretch">
            <span
              aria-hidden
              className="pointer-events-none absolute inset-x-3 top-2 z-[1] text-[13px] font-medium text-[var(--text-secondary)]"
            >
              忽略本期剩余价值
            </span>
            <textarea
              value={draft.costIgnoredText}
              onChange={(event) => patch("costIgnoredText", event.target.value)}
              aria-label="忽略本期剩余价值"
              className="surface-inset min-h-[160px] w-full flex-1 resize-none px-3 pb-2 pt-8 text-[13px] outline-none"
            />
          </label>
        </div>
      </InstancePanel>

      <InstancePanel
        kicker={<><span className="instance-panel-kicker-num">07</span>溢价</>}
        title="收购溢价"
        aside={
          <div className="text-[11px] text-[var(--text-tertiary)]">
            {clientsLoading ? "载入中" : `已设置 ${premiumConfiguredCount} 个节点`}
          </div>
        }
      >
        <div className="flex flex-col gap-3">
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

          {!clientsLoading && sortedClients.length > 0 && (
            <PremiumList
              clients={sortedClients}
              costPremiums={draft.costPremiums}
              detailByUuid={premiumDetailByUuid}
              rateLoading={premiumRateQuery.isLoading}
              acquiredAtMax={acquiredAtMax}
              onPatchPaid={patchPremiumPaid}
              onPatchAcquiredAt={patchPremiumAcquiredAt}
              onPatchRegularPrice={patchPremiumRegularPrice}
            />
          )}
        </div>
      </InstancePanel>

      <InstancePanel
        kicker={<><span className="instance-panel-kicker-num">08</span>延迟</>}
        title="主页延迟检测"
        aside={
          <div className="text-[11px] text-[var(--text-tertiary)]">
            {tasksLoading || clientsLoading
              ? "载入中"
              : `${sortedTasks.length} 个任务`}
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="surface-inset px-4 py-4">
            <p className="mb-4 text-[12px] leading-relaxed text-[var(--text-secondary)]">
              默认自动读取 Komari 后台绑定：单个探测点直接显示；多个探测点按任务权重顺序显示最前项。
              仅在个别实例需要例外时使用手动配置。
            </p>
            <PingNodeConfigControl
              clients={sortedClients}
              tasks={sortedTasks}
              overrides={draft.homepagePingNodeTaskIds}
              configuredNodeCount={pingConfiguredNodeCount}
              fakePingForUnbound={draft.fakePingForUnbound}
              disabled={clientsLoading || tasksLoading}
              saving={saving}
              saveError={error}
              saveDisabled={!isDirty || draftCostRateApiUrlInvalid}
              onChange={patchPingNodeTaskIds}
              onSave={handleSave}
            />
          </div>

          <ToggleRow
            field="fakePingForUnbound"
            title="未绑定探测点显示模拟延迟"
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
              <span>当前还没有 Ping 任务；在线实例会显示未配置或模拟延迟。</span>
              <a href="/admin/ping" className="theme-manage-inline-link">
                前往后台 Ping 管理创建任务
              </a>
            </div>
          )}
        </div>
      </InstancePanel>

    </div>
  );
}
