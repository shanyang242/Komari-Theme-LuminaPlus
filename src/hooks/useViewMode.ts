import { useCallback, useSyncExternalStore } from "react";
import { useThemeSettings } from "@/hooks/useThemeSettings";
import { MOBILE_VIEWPORT_QUERY, subscribeMediaQuery } from "@/utils/mediaQuery";
import { isNodeViewMode, type NodeViewMode } from "@/utils/themeSettings";

const DESKTOP_OVERRIDE_KEY = "lumina-plus:view-mode:desktop";
const MOBILE_OVERRIDE_KEY = "lumina-plus:view-mode:mobile";
export const MOBILE_VIEW_MODE_QUERY = MOBILE_VIEWPORT_QUERY;
const VIEW_MODE_CYCLE: readonly NodeViewMode[] = ["large", "compact"];

export type ViewModeDevice = "desktop" | "mobile";

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
    // session storage 不可用时，保留内存里的行为。
  }
}

function clearOverride(key: string) {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // session storage 不可用时没什么可清的。
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
  // useSyncExternalStore 每次 render 都会调 getSnapshot，所以它必须便宜且稳定。
  // 只读一次 storage/matchMedia 来初始化缓存；之后由 media/storage/setMode
  // 处理器保持 snapshot 新鲜。
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

// override 存 sessionStorage(按标签页隔离),storage 事件只覆盖共享同一 session 的
// window.open/iframe 场景,普通独立标签页之间不同步。整个模块只注册一次(在第一个
// 订阅者时),所有消费者共享同一份全局状态,否则 N 个组件会装 N 个一样的 listener。
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
      // 选中当前主题默认值时，清掉 session override 重新跟随默认值，而不是钉一个
      // 永远去不掉的 override（那样还会让未来的默认值变化无法生效）。
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

// 给用不了 hook 的场景做非响应式读取（如 class ErrorBoundary 的诊断）。返回
// device + 任意 session override；不含主题默认值，因为解析它需要 themeSettings（一个
// hook），但 device + override 在常见情况下已能区分 compact 和 large。
export function readViewModeHint(): string {
  try {
    const { device, override } = readSnapshot();
    return override ? `${device}/${override}(override)` : `${device}/default`;
  } catch {
    return "unknown";
  }
}
