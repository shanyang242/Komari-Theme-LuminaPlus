import { useCallback, useSyncExternalStore } from "react";
import { useThemeSettings } from "@/hooks/useThemeSettings";
import { MOBILE_VIEWPORT_QUERY, subscribeMediaQuery } from "@/utils/mediaQuery";
import { isNodeViewMode, type NodeViewMode } from "@/utils/themeSettings";

const DESKTOP_OVERRIDE_KEY = "lumina-plus:view-mode:desktop";
const MOBILE_OVERRIDE_KEY = "lumina-plus:view-mode:mobile";
export const MOBILE_VIEW_MODE_QUERY = MOBILE_VIEWPORT_QUERY;
const VIEW_MODE_CYCLE: readonly NodeViewMode[] = ["large", "compact"];

type ViewModeDevice = "desktop" | "mobile";

export function getNextViewMode(mode: NodeViewMode): NodeViewMode {
  const cycle = VIEW_MODE_CYCLE;
  return cycle[(cycle.indexOf(mode) + 1) % cycle.length] ?? cycle[0];
}

interface ViewModeState {
  device: ViewModeDevice;
  override: NodeViewMode | null;
}

const listeners = new Set<() => void>();
let mediaQuery: MediaQueryList | null = null;
let subscribedMediaQuery: MediaQueryList | null = null;
let snapshot: ViewModeState = {
  device: "desktop",
  override: null,
};

function readOverride(key: string): NodeViewMode | null {
  try {
    const value = sessionStorage.getItem(key);
    if (value == null) return null;
    return isNodeViewMode(value) ? value : null;
  } catch {
    return null;
  }
}

function writeOverride(key: string, value: NodeViewMode) {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // 忽略存储异常
  }
}

function clearOverride(key: string) {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // 忽略存储异常
  }
}

function getMediaQuery() {
  if (typeof window === "undefined" || !window.matchMedia) return null;
  mediaQuery ??= window.matchMedia(MOBILE_VIEWPORT_QUERY);
  return mediaQuery;
}

function getDevice(): ViewModeState["device"] {
  return getMediaQuery()?.matches ? "mobile" : "desktop";
}

function getOverrideKey(device: ViewModeState["device"]) {
  return device === "mobile" ? MOBILE_OVERRIDE_KEY : DESKTOP_OVERRIDE_KEY;
}

function readSnapshot(): ViewModeState {
  const device = getDevice();
  return {
    device,
    override: readOverride(getOverrideKey(device)),
  };
}

function refreshSnapshot() {
  const next = readSnapshot();
  if (snapshot.device !== next.device || snapshot.override !== next.override) {
    snapshot = next;
  }
  return snapshot;
}

let snapshotInitialized = false;

function getSnapshot(): ViewModeState {
  // 首次懒初始化缓存，后续由事件与 setMode 维护
  if (!snapshotInitialized) {
    snapshotInitialized = true;
    refreshSnapshot();
  }
  return snapshot;
}

function emit() {
  for (const listener of listeners) listener();
}

const handleMediaChange = () => {
  refreshSnapshot();
  emit();
};

let mediaUnsubscribe: (() => void) | null = null;

function ensureMediaSubscription() {
  const mq = getMediaQuery();
  if (!mq || subscribedMediaQuery === mq) return;
  clearMediaSubscription();
  subscribedMediaQuery = mq;
  mediaUnsubscribe = subscribeMediaQuery(mq, handleMediaChange);
}

function clearMediaSubscription() {
  mediaUnsubscribe?.();
  mediaUnsubscribe = null;
  subscribedMediaQuery = null;
}

const handleStorage = (event: StorageEvent) => {
  if (event.key === DESKTOP_OVERRIDE_KEY || event.key === MOBILE_OVERRIDE_KEY) {
    refreshSnapshot();
    emit();
  }
};
let storageListenerAttached = false;

function ensureStorageSubscription() {
  if (storageListenerAttached || typeof window === "undefined") return;
  window.addEventListener("storage", handleStorage);
  storageListenerAttached = true;
}

function clearStorageSubscription() {
  if (!storageListenerAttached || typeof window === "undefined") return;
  window.removeEventListener("storage", handleStorage);
  storageListenerAttached = false;
}

function subscribe(listener: () => void) {
  const wasEmpty = listeners.size === 0;
  listeners.add(listener);
  if (wasEmpty) {
    ensureMediaSubscription();
    ensureStorageSubscription();
  }

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      clearMediaSubscription();
      clearStorageSubscription();
    }
  };
}

export function useViewMode() {
  const themeSettings = useThemeSettings();
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const isMobile = state.device === "mobile";
  const defaultMode = isMobile
    ? themeSettings.mobileNodeViewMode
    : themeSettings.desktopNodeViewMode;
  const resolved = state.override ?? defaultMode;
  const mode = resolved;
  const nextMode = getNextViewMode(mode);

  const setMode = useCallback(
    (next: NodeViewMode) => {
      const key = getOverrideKey(state.device);
      // 切回默认值时清除 override，以继续跟随主题默认变更
      if (next === defaultMode) {
        clearOverride(key);
      } else {
        writeOverride(key, next);
      }
      refreshSnapshot();
      emit();
    },
    [state.device, defaultMode],
  );

  const toggleMode = useCallback(() => {
    setMode(nextMode);
  }, [nextMode, setMode]);

  return {
    device: state.device,
    mode,
    nextMode,
    setMode,
    toggleMode,
  };
}

/** 非响应式读取视图模式提示（供 class ErrorBoundary 诊断使用）。 */
export function readViewModeHint(): string {
  try {
    const { device, override } = readSnapshot();
    return override ? `${device}/${override}(override)` : `${device}/default`;
  } catch {
    return "unknown";
  }
}
