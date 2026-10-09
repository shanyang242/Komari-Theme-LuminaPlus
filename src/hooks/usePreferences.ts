import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useThemeSettings } from "@/hooks/useThemeSettings";
import { subscribeMediaQuery } from "@/utils/mediaQuery";
import { isAppearance, type Appearance } from "@/utils/themeSettings";

type ResolvedAppearance = "light" | "dark";
const APPEARANCE_STORAGE_KEY = "appearance";
const APPEARANCE_DEFAULT_STORAGE_KEY = "appearance_default";
const SYSTEM_DARK_QUERY = "(prefers-color-scheme: dark)";

interface PrefsState {
  appearance: Appearance;
  resolvedAppearance: ResolvedAppearance;
}

const DEFAULTS: PrefsState = {
  appearance: "system",
  resolvedAppearance: "dark",
};

let themeFlipTimer: number | null = null;
let hasExplicitAppearancePreference = false;
let systemAppearanceMediaQuery: MediaQueryList | null = null;

function getSystemAppearanceMediaQuery() {
  if (typeof window === "undefined" || !window.matchMedia) return null;
  systemAppearanceMediaQuery ??= window.matchMedia(SYSTEM_DARK_QUERY);
  return systemAppearanceMediaQuery;
}

function resolveAppearance(a: Appearance): ResolvedAppearance {
  if (a === "system") {
    return getSystemAppearanceMediaQuery()?.matches ? "dark" : "light";
  }
  return a;
}

function parseStoredAppearance(raw: string | null): Appearance | null {
  return isAppearance(raw) ? raw : null;
}

function readStorageItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorageItem(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

function readStoredAppearance() {
  const parsed = parseStoredAppearance(readStorageItem(APPEARANCE_STORAGE_KEY));
  const fallback =
    parseStoredAppearance(readStorageItem(APPEARANCE_DEFAULT_STORAGE_KEY)) ??
    DEFAULTS.appearance;
  return {
    appearance: parsed ?? fallback,
    hasExplicitPreference: parsed != null,
  };
}

function persistAppearance(value: Appearance) {
  writeStorageItem(APPEARANCE_STORAGE_KEY, value);
}

function persistDefaultAppearance(value: Appearance) {
  writeStorageItem(APPEARANCE_DEFAULT_STORAGE_KEY, value);
}

const listeners = new Set<() => void>();
let snapshot: PrefsState = { ...DEFAULTS };

function emit() {
  for (const l of listeners) l();
}

function markThemeFlip() {
  const root = document.documentElement;
  root.classList.add("theme-flip");
  if (themeFlipTimer != null) {
    window.clearTimeout(themeFlipTimer);
  }
  themeFlipTimer = window.setTimeout(() => {
    root.classList.remove("theme-flip");
    themeFlipTimer = null;
  }, 140);
}

function applyResolvedAppearance(resolvedAppearance: ResolvedAppearance) {
  const root = document.documentElement;
  root.dataset.appearance = resolvedAppearance;
  root.style.colorScheme = resolvedAppearance;
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) {
    meta.content = resolvedAppearance === "dark" ? "#000000" : "#F5F5F7";
  }
}

function commit(next: Partial<PrefsState>) {
  const merged: PrefsState = { ...snapshot, ...next };
  if (next.appearance) {
    merged.resolvedAppearance = resolveAppearance(merged.appearance);
  }
  if (
    snapshot.appearance === merged.appearance &&
    snapshot.resolvedAppearance === merged.resolvedAppearance
  ) {
    return;
  }
  if (snapshot.resolvedAppearance !== merged.resolvedAppearance) {
    markThemeFlip();
  }
  snapshot = merged;
  applyResolvedAppearance(merged.resolvedAppearance);
  emit();
}

function refreshSystemAppearance() {
  if (snapshot.appearance === "system") {
    commit({ appearance: "system" });
  }
}

function handleVisibilityChange() {
  if (!document.hidden) refreshSystemAppearance();
}

let systemListenersAttached = false;
let mediaUnsubscribe: (() => void) | null = null;

function ensureSystemListeners() {
  if (systemListenersAttached || typeof window === "undefined") return;
  systemListenersAttached = true;
  const mediaQuery = getSystemAppearanceMediaQuery();
  if (mediaQuery) {
    mediaUnsubscribe = subscribeMediaQuery(mediaQuery, refreshSystemAppearance);
  }
  window.addEventListener("focus", refreshSystemAppearance);
  document.addEventListener("visibilitychange", handleVisibilityChange);
}

function clearSystemListeners() {
  if (!systemListenersAttached || typeof window === "undefined") return;
  systemListenersAttached = false;
  mediaUnsubscribe?.();
  mediaUnsubscribe = null;
  window.removeEventListener("focus", refreshSystemAppearance);
  document.removeEventListener("visibilitychange", handleVisibilityChange);
}

function initializeAppearance() {
  const stored = readStoredAppearance();
  hasExplicitAppearancePreference = stored.hasExplicitPreference;
  if (stored.hasExplicitPreference) {
    persistAppearance(stored.appearance);
  }
  snapshot = {
    appearance: stored.appearance,
    resolvedAppearance: resolveAppearance(stored.appearance),
  };
  applyResolvedAppearance(snapshot.resolvedAppearance);
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  initializeAppearance();
}

function subscribe(l: () => void) {
  const wasEmpty = listeners.size === 0;
  listeners.add(l);
  if (wasEmpty) ensureSystemListeners();
  return () => {
    listeners.delete(l);
    if (listeners.size === 0) clearSystemListeners();
  };
}

function getSnapshot() {
  return snapshot;
}

export function usePreferences() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const themeSettings = useThemeSettings();

  useEffect(() => {
    if (!themeSettings.isReady) return;
    if (hasExplicitAppearancePreference) return;
    const defaultAppearance = themeSettings.defaultAppearance;
    persistDefaultAppearance(defaultAppearance);
    commit({ appearance: defaultAppearance });
  }, [themeSettings.defaultAppearance, themeSettings.isReady]);

  const setAppearance = useCallback((a: Appearance) => {
    hasExplicitAppearancePreference = true;
    persistAppearance(a);
    commit({ appearance: a });
  }, []);

  return {
    appearance: state.appearance,
    resolvedAppearance: state.resolvedAppearance,
    setAppearance,
  };
}
