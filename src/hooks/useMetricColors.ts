import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { clearCssColorCache } from "@/components/node/CanvasStrip";
import { usePublicConfig } from "@/hooks/usePublicConfig";
import { saveThemeSettings } from "@/services/api";
import type { PublicConfig } from "@/types/komari";

// 用户自定义的卡片指标配色。覆盖 tokens.css 里的 --* 变量（内联写到 <html>）。
// 存到后端 theme_settings.metricColors（全局、跨设备同步、清缓存不丢；仅登录管理员可改）。
// 负载跟随独立色、流量方向/速率热力同理。

export type MetricColorKey =
  | "cpu"
  | "memory"
  | "disk"
  | "load"
  | "swap"
  | "speedIdle"
  | "speedLow"
  | "speedHigh"
  | "speedMax"
  | "trafficUp"
  | "trafficDown";

export type MetricColorGroup = "metric" | "speed" | "traffic";

export const METRIC_COLOR_GROUPS: ReadonlyArray<{ id: MetricColorGroup; label: string }> = [
  { id: "metric", label: "卡片配色" },
  { id: "speed", label: "速率热力" },
  { id: "traffic", label: "流量方向" },
];

export const METRIC_COLOR_META: ReadonlyArray<{
  key: MetricColorKey;
  label: string;
  cssVar: string;
  group: MetricColorGroup;
}> = [
  { key: "cpu", label: "CPU", cssVar: "--progress-cpu", group: "metric" },
  { key: "memory", label: "内存", cssVar: "--progress-memory", group: "metric" },
  { key: "disk", label: "磁盘", cssVar: "--progress-disk", group: "metric" },
  { key: "load", label: "负载", cssVar: "--progress-load", group: "metric" },
  { key: "swap", label: "Swap", cssVar: "--progress-swap", group: "metric" },
  { key: "speedIdle", label: "超低速", cssVar: "--speed-idle", group: "speed" },
  { key: "speedLow", label: "低速", cssVar: "--speed-low", group: "speed" },
  { key: "speedHigh", label: "高速", cssVar: "--speed-high", group: "speed" },
  { key: "speedMax", label: "急速", cssVar: "--speed-max", group: "speed" },
  { key: "trafficUp", label: "上行", cssVar: "--traffic-up", group: "traffic" },
  { key: "trafficDown", label: "下行", cssVar: "--traffic-down", group: "traffic" },
];

export type MetricColors = Partial<Record<MetricColorKey, string>>;

const SETTINGS_KEY = "metricColors";
const HEX = /^#[0-9a-f]{6}$/;

function toInputHex(value: string): string {
  let v = value.trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(v)) v = "#" + [...v.slice(1)].map((c) => c + c).join("");
  return HEX.test(v) ? v : "#888888";
}

/** 从后端 theme_settings 解析出已保存的指标配色（校验 hex 与已知 key）。 */
export function readMetricColorsFromSettings(
  settings: Record<string, unknown> | undefined,
): MetricColors {
  const raw = settings?.[SETTINGS_KEY];
  if (!raw || typeof raw !== "object") return {};
  const source = raw as Record<string, unknown>;
  const out: MetricColors = {};
  for (const { key } of METRIC_COLOR_META) {
    const v = source[key];
    if (typeof v === "string" && HEX.test(v.toLowerCase())) out[key] = v.toLowerCase();
  }
  return out;
}

// ---- 已应用配色：写 CSS 变量 + 维护 version 让 canvas 卡片即时重绘 ----
let version = 0;
let appliedSig = "__init__";
let rafId: number | null = null;
const listeners = new Set<() => void>();

// 编辑会话:管理员一旦改色,直到这一笔保存成功回环之前都置 true。期间本地草稿/预览是
// 唯一权威——任何无关的 public config 刷新(窗口聚焦、其它设置保存返回旧 metricColors)
// 都不得经全局同步或编辑器把颜色打回旧值。全局同步与编辑器共用这一个模块级标记。
let metricColorEditing = false;

function bumpVersionThrottled() {
  // 拖动取色器时每帧多次调用，version+emit 合并到每帧一次，避免每个事件都重渲染/重绘所有卡片。
  if (rafId != null) return;
  rafId = requestAnimationFrame(() => {
    rafId = null;
    version += 1;
    for (const l of listeners) l();
  });
}

/** 把一组配色应用到 <html>（CSS 变量即时覆盖；canvas 经 version 重绘）。相同配色不重复应用。 */
export function applyMetricColors(colors: MetricColors) {
  const sig = JSON.stringify(colors ?? {});
  if (sig === appliedSig) return;
  appliedSig = sig;
  const root = document.documentElement;
  for (const { key, cssVar } of METRIC_COLOR_META) {
    const v = colors[key];
    if (v) root.style.setProperty(cssVar, v);
    else root.style.removeProperty(cssVar);
  }
  // 清掉 canvas 颜色缓存，否则进度条/圆点会继续画旧色。
  clearCssColorCache();
  bumpVersionThrottled();
}

/** 供 canvas 卡片（NodeCard）订阅：配色变化时拼进 redrawKey 触发重绘。 */
export function useMetricColorsVersion(): number {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    () => version,
    () => version,
  );
}

/** 读取每个指标当前生效的 hex（含默认 token），供取色器显示初值。 */
export function readEffectiveColors(): Record<MetricColorKey, string> {
  const styles = getComputedStyle(document.documentElement);
  const out = {} as Record<MetricColorKey, string>;
  for (const { key, cssVar } of METRIC_COLOR_META) out[key] = toInputHex(styles.getPropertyValue(cssVar));
  return out;
}

/** 全局：把后端保存的配色应用到所有访客（在 AppShell 挂载一次）。 */
export function useMetricColorsSync() {
  const { data: config } = usePublicConfig();
  const colors = useMemo(
    () => readMetricColorsFromSettings(config?.theme_settings),
    [config?.theme_settings],
  );
  useEffect(() => {
    // 管理员正在编辑配色时,预览由编辑器驱动;此处别用服务端值覆盖,避免一次 refetch
    // 把正在拖动的颜色闪回旧值。保存成功会清除标记并 refetch,届时这里再采纳新值。
    if (metricColorEditing) return;
    applyMetricColors(colors);
  }, [colors]);
}

/** 管理员编辑：改色即时预览 + 防抖保存到后端 theme_settings。 */
export function useMetricColorsEditor() {
  const { data: config } = usePublicConfig();
  const queryClient = useQueryClient();
  const serverColors = useMemo(
    () => readMetricColorsFromSettings(config?.theme_settings),
    [config?.theme_settings],
  );

  const [draft, setDraft] = useState<MetricColors>(serverColors);
  const [saveError, setSaveError] = useState(false);
  const draftRef = useRef<MetricColors>(serverColors);
  const saveTimer = useRef<number | null>(null);
  const serverColorsRef = useRef<MetricColors>(serverColors);
  // 仍在防抖窗口内、尚未落库的草稿；卸载时据此补存，避免快速关闭面板丢失改动。
  const pendingColorsRef = useRef<MetricColors | null>(null);
  // 组件是否仍挂载——异步保存回来后据此决定是否还能 setState。
  const mountedRef = useRef(true);
  // 串行化保存:同一时刻只允许一个请求在飞。在飞期间到来的保存只记录「最新一笔」
  // (queuedColorsRef),当前请求落库后再发,杜绝慢的旧请求最后落库覆盖掉新颜色。
  const inFlightRef = useRef(false);
  const hasQueuedRef = useRef(false);
  const queuedColorsRef = useRef<MetricColors>({});

  // 后端配色变化（含自身保存后的 refetch）时同步草稿。但正在编辑(拖动/防抖/保存未回环)
  // 时本地草稿压过服务端:不让一次无关的 refetch 返回旧 metricColors 把草稿打回旧值。
  // 保存成功会清除编辑标记并触发 refetch,届时再采纳(此时服务端已等于本地草稿)。
  useEffect(() => {
    if (metricColorEditing) return;
    serverColorsRef.current = serverColors;
    draftRef.current = serverColors;
    setDraft(serverColors);
  }, [serverColors]);

  const finishEditing = useCallback((restoreSaved = false) => {
    metricColorEditing = false;
    if (restoreSaved) applyMetricColors(serverColorsRef.current);
  }, []);

  // 真正写后端。供防抖计时器与卸载补存两处复用。saveError 只在仍挂载时更新——
  // 即便请求在飞途中组件卸载（防抖已触发那段窄窗口），回来也不会对已卸载组件 setState。
  // 串行化:在飞期间再调只暂存最新一笔,当前落库后接着发,旧请求不会覆盖新颜色。
  const persist = useCallback(
    async (colors: MetricColors) => {
      if (!config) {
        if (!mountedRef.current) finishEditing(true);
        return;
      }
      if (inFlightRef.current) {
        queuedColorsRef.current = colors;
        hasQueuedRef.current = true;
        return;
      }
      inFlightRef.current = true;
      let current = colors;
      let lastOk = false;
      let savedAny = false;
      try {
        for (;;) {
          // 每轮都取最新的 public 缓存做合并基:避免拿过期 theme_settings 回写,
          // 把主题管理页同期保存的其它设置覆盖掉。
          const latest = queryClient.getQueryData<PublicConfig>(["public"]) ?? config;
          const nextSettings: Record<string, unknown> = { ...(latest.theme_settings ?? {}) };
          if (Object.keys(current).length > 0) nextSettings[SETTINGS_KEY] = current;
          else delete nextSettings[SETTINGS_KEY];
          try {
            await saveThemeSettings(latest.theme, nextSettings);
            lastOk = true;
            savedAny = true;
            serverColorsRef.current = current;
            if (mountedRef.current) setSaveError(false);
          } catch {
            lastOk = false;
            if (mountedRef.current) setSaveError(true);
          }
          if (!hasQueuedRef.current) break;
          hasQueuedRef.current = false;
          current = queuedColorsRef.current;
        }
      } finally {
        inFlightRef.current = false;
      }
      if (lastOk) {
        finishEditing();
      } else if (!mountedRef.current) {
        finishEditing(true);
      }
      if (savedAny) {
        void queryClient.invalidateQueries({ queryKey: ["public"] });
      }
    },
    [config, finishEditing, queryClient],
  );

  // 用 ref 持有最新 persist，让卸载 effect 保持空依赖——只在真正卸载时跑，
  // 不会因 config 刷新（persist 重建）而把进行中的草稿提前补存。
  const persistRef = useRef(persist);
  useEffect(() => {
    persistRef.current = persist;
  }, [persist]);

  // 挂载标记 + 卸载收尾。卸载时先置 mounted=false（让进行中/补存的 persist 回来后不再 setState），
  // 再清防抖计时器，并把未落库的草稿补存一次——在防抖窗口内关闭面板不丢改动。
  // (用 effect body 重置 mounted=true 以兼容 StrictMode 的卸载/重挂。)
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (saveTimer.current != null) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      if (pendingColorsRef.current != null) {
        // 有待补存:其 persist 的收尾会据 mountedRef(此刻已 false)释放编辑标记。
        void persistRef.current(pendingColorsRef.current);
        pendingColorsRef.current = null;
      } else if (inFlightRef.current) {
        // 有在飞保存:由该 persist 的收尾释放,这里不动,避免在飞窗口里预览闪回旧色。
      } else {
        // 无待补存/在飞保存时关闭，直接回到已保存配色；覆盖失败后的本地预览色。
        finishEditing(true);
      }
    };
  }, [finishEditing]);

  const scheduleSave = useCallback(
    (colors: MetricColors) => {
      if (!config) return;
      if (saveTimer.current != null) clearTimeout(saveTimer.current);
      pendingColorsRef.current = colors;
      // 防抖：拖动停手后再写后端，避免每次 onChange 都发请求。
      saveTimer.current = window.setTimeout(() => {
        saveTimer.current = null;
        pendingColorsRef.current = null;
        void persist(colors);
      }, 500);
    },
    [config, persist],
  );

  const commit = useCallback(
    (next: MetricColors) => {
      // 一旦本地改色就进入编辑会话:在保存成功回环前,本地草稿/预览压过任何服务端刷新。
      metricColorEditing = true;
      draftRef.current = next;
      setDraft(next);
      applyMetricColors(next); // 即时预览
      scheduleSave(next); // 防抖落库
    },
    [scheduleSave],
  );

  const setColor = useCallback(
    (key: MetricColorKey, hex: string) => {
      const v = hex.toLowerCase();
      if (HEX.test(v)) commit({ ...draftRef.current, [key]: v });
    },
    [commit],
  );

  const resetColor = useCallback(
    (key: MetricColorKey) => {
      const next = { ...draftRef.current };
      delete next[key];
      commit(next);
    },
    [commit],
  );

  const resetAll = useCallback(() => commit({}), [commit]);

  return { colors: draft, setColor, resetColor, resetAll, saveError };
}
