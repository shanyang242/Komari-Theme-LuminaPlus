import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { clearCssColorCache } from "@/components/node/CanvasStrip";
import { usePublicConfig } from "@/hooks/usePublicConfig";
import { saveThemeSettings } from "@/services/api";
import type { PublicConfig } from "@/types/komari";

// 指标色和暗色深度保存到 theme_settings，并通过 CSS 变量全局应用。

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

type MetricColorGroup = "metric" | "speed" | "traffic";

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

type MetricColors = Partial<Record<MetricColorKey, string>>;

const SETTINGS_KEY = "metricColors";
const DARK_DEPTH_SETTINGS_KEY = "darkDepth";
const DARK_DEPTH_CACHE_KEY = "lumina-plus:dark-depth";
const HEX = /^#[0-9a-f]{6}$/;
export const DEFAULT_DARK_DEPTH = 0;

interface PaletteDraft {
  colors: MetricColors;
  darkDepth: number;
}

function toInputHex(value: string): string {
  let v = value.trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(v)) v = "#" + [...v.slice(1)].map((c) => c + c).join("");
  return HEX.test(v) ? v : "#888888";
}

/** 从后端 theme_settings 解析出已保存的指标配色（校验 hex 与已知 key）。 */
function readMetricColorsFromSettings(
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

export function normalizeDarkDepth(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_DARK_DEPTH;
  return Math.min(100, Math.max(0, Math.round(parsed)));
}

/** 缺省值 0 就是原有 Dark Dimmed 灰黑；只接受 0–100 的受限黑色深度。 */
export function readDarkDepthFromSettings(
  settings: Record<string, unknown> | undefined,
): number {
  return normalizeDarkDepth(settings?.[DARK_DEPTH_SETTINGS_KEY]);
}

function readPaletteDraft(settings: Record<string, unknown> | undefined): PaletteDraft {
  return {
    colors: readMetricColorsFromSettings(settings),
    darkDepth: readDarkDepthFromSettings(settings),
  };
}

// ---- 已应用配色：写 CSS 变量 + 维护 version 让 canvas 卡片即时重绘 ----
let version = 0;
let appliedSig = "__init__";
let appliedDarkDepth: number | null = null;
let rafId: number | null = null;
const listeners = new Set<() => void>();

// 编辑期间以本地预览为准，避免 public config 刷新闪回旧值。
let metricColorEditing = false;

function bumpVersionThrottled() {
  // 合并同一帧的取色事件，避免重复重绘所有卡片。
  if (rafId != null) return;
  rafId = requestAnimationFrame(() => {
    rafId = null;
    version += 1;
    for (const l of listeners) l();
  });
}

/** 把一组配色应用到 <html>（CSS 变量即时覆盖；canvas 经 version 重绘）。相同配色不重复应用。 */
function applyMetricColors(colors: MetricColors) {
  const sig = JSON.stringify(colors ?? {});
  if (sig === appliedSig) return;
  appliedSig = sig;
  const root = document.documentElement;
  for (const { key, cssVar } of METRIC_COLOR_META) {
    const v = colors[key];
    if (v) root.style.setProperty(cssVar, v);
    else root.style.removeProperty(cssVar);
  }
  clearCssColorCache();
  bumpVersionThrottled();
}

/** 只设置强度变量；亮色 token 不引用它，因此调整不会污染浅色模式。 */
function applyDarkDepth(value: number) {
  const depth = normalizeDarkDepth(value);
  if (depth === appliedDarkDepth) return;
  appliedDarkDepth = depth;
  const root = document.documentElement;
  if (depth === DEFAULT_DARK_DEPTH) root.style.removeProperty("--dark-depth");
  else root.style.setProperty("--dark-depth", String(depth));
  clearCssColorCache();
  bumpVersionThrottled();
  try {
    if (depth === DEFAULT_DARK_DEPTH) localStorage.removeItem(DARK_DEPTH_CACHE_KEY);
    else localStorage.setItem(DARK_DEPTH_CACHE_KEY, String(depth));
  } catch {
    // 首帧缓存失败不影响当前预览与后端设置。
  }
}

function applyPalette(palette: PaletteDraft) {
  applyMetricColors(palette.colors);
  applyDarkDepth(palette.darkDepth);
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
  const palette = useMemo(
    () => (config ? readPaletteDraft(config.theme_settings) : null),
    [config],
  );
  useEffect(() => {
    // 配置返回前保留 index.html 恢复的首帧缓存。
    if (!palette) return;
    if (metricColorEditing) return;
    applyPalette(palette);
  }, [palette]);
}

/** 管理员编辑：改色/暗色深度即时预览 + 防抖保存到后端 theme_settings。 */
export function useMetricColorsEditor() {
  const { data: config } = usePublicConfig();
  const queryClient = useQueryClient();
  const serverPalette = useMemo(
    () => readPaletteDraft(config?.theme_settings),
    [config?.theme_settings],
  );

  const [draft, setDraft] = useState<PaletteDraft>(serverPalette);
  const [saveError, setSaveError] = useState(false);
  const draftRef = useRef<PaletteDraft>(serverPalette);
  const saveTimer = useRef<number | null>(null);
  const serverPaletteRef = useRef<PaletteDraft>(serverPalette);
  // 防抖窗口内的草稿会在卸载时补存。
  const pendingPaletteRef = useRef<PaletteDraft | null>(null);
  const mountedRef = useRef(true);
  // 保存串行化，在飞期间只保留最新一笔排队值。
  const inFlightRef = useRef(false);
  const hasQueuedRef = useRef(false);
  const queuedPaletteRef = useRef<PaletteDraft>({ colors: {}, darkDepth: DEFAULT_DARK_DEPTH });

  // 非编辑状态才接受服务端回流;refetch 每次给新引用,同内容不重置以免多余渲染。
  useEffect(() => {
    if (metricColorEditing) return;
    if (JSON.stringify(serverPaletteRef.current) === JSON.stringify(serverPalette)) return;
    serverPaletteRef.current = serverPalette;
    draftRef.current = serverPalette;
    setDraft(serverPalette);
  }, [serverPalette]);

  const finishEditing = useCallback((restoreSaved = false) => {
    metricColorEditing = false;
    if (restoreSaved) applyPalette(serverPaletteRef.current);
  }, []);

  // 防抖计时器与卸载补存共用；卸载后不再 setState。
  const persist = useCallback(
    async (palette: PaletteDraft) => {
      if (!config) {
        if (!mountedRef.current) finishEditing(true);
        return;
      }
      if (inFlightRef.current) {
        queuedPaletteRef.current = palette;
        hasQueuedRef.current = true;
        return;
      }
      inFlightRef.current = true;
      let current = palette;
      let lastOk = false;
      let savedAny = false;
      try {
        for (;;) {
          // 合并最新 public 缓存，保留同期保存的其他主题设置。
          const latest = queryClient.getQueryData<PublicConfig>(["public"]) ?? config;
          const nextSettings: Record<string, unknown> = { ...(latest.theme_settings ?? {}) };
          if (Object.keys(current.colors).length > 0) nextSettings[SETTINGS_KEY] = current.colors;
          else delete nextSettings[SETTINGS_KEY];
          if (current.darkDepth !== DEFAULT_DARK_DEPTH) {
            nextSettings[DARK_DEPTH_SETTINGS_KEY] = current.darkDepth;
          } else {
            delete nextSettings[DARK_DEPTH_SETTINGS_KEY];
          }
          try {
            await saveThemeSettings(latest.theme, nextSettings);
            lastOk = true;
            savedAny = true;
            serverPaletteRef.current = current;
            if (mountedRef.current) setSaveError(false);
          } catch {
            lastOk = false;
            if (mountedRef.current) setSaveError(true);
          }
          if (!hasQueuedRef.current) break;
          hasQueuedRef.current = false;
          current = queuedPaletteRef.current;
        }
      } finally {
        inFlightRef.current = false;
      }
      const hasPendingSave = pendingPaletteRef.current != null || saveTimer.current != null;
      if (lastOk && !hasPendingSave) {
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

  // 卸载 effect 通过 ref 使用最新 persist，不受 config 刷新影响。
  const persistRef = useRef(persist);
  useEffect(() => {
    persistRef.current = persist;
  }, [persist]);

  // 卸载时清理计时器，并补存尚未落库的草稿。
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (saveTimer.current != null) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      if (pendingPaletteRef.current != null) {
        void persistRef.current(pendingPaletteRef.current);
        pendingPaletteRef.current = null;
      } else if (inFlightRef.current) {
        // 在飞请求负责收尾。
      } else {
        finishEditing(true);
      }
    };
  }, [finishEditing]);

  const scheduleSave = useCallback(
    (palette: PaletteDraft) => {
      if (!config) return;
      if (saveTimer.current != null) clearTimeout(saveTimer.current);
      pendingPaletteRef.current = palette;
      saveTimer.current = window.setTimeout(() => {
        saveTimer.current = null;
        pendingPaletteRef.current = null;
        void persist(palette);
      }, 500);
    },
    [config, persist],
  );

  const commit = useCallback(
    (next: PaletteDraft) => {
      metricColorEditing = true;
      draftRef.current = next;
      setDraft(next);
      applyPalette(next); // 即时预览
      scheduleSave(next); // 防抖落库
    },
    [scheduleSave],
  );

  const setColor = useCallback(
    (key: MetricColorKey, hex: string) => {
      const v = hex.toLowerCase();
      if (HEX.test(v)) {
        commit({
          ...draftRef.current,
          colors: { ...draftRef.current.colors, [key]: v },
        });
      }
    },
    [commit],
  );

  const resetColor = useCallback(
    (key: MetricColorKey) => {
      const colors = { ...draftRef.current.colors };
      delete colors[key];
      commit({ ...draftRef.current, colors });
    },
    [commit],
  );

  const setDarkDepth = useCallback(
    (value: number) => {
      commit({ ...draftRef.current, darkDepth: normalizeDarkDepth(value) });
    },
    [commit],
  );

  const resetAll = useCallback(
    () => commit({ colors: {}, darkDepth: DEFAULT_DARK_DEPTH }),
    [commit],
  );

  return {
    colors: draft.colors,
    darkDepth: draft.darkDepth,
    setColor,
    resetColor,
    setDarkDepth,
    resetAll,
    saveError,
  };
}
