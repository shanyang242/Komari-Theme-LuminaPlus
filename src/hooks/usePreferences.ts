import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useThemeSettings } from "@/hooks/useThemeSettings";
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
  if (raw == null) {
    return null;
  }

  if (isAppearance(raw)) {
    return raw;
  }

  try {
    const parsed = JSON.parse(raw);
    return isAppearance(parsed) ? parsed : null;
  } catch {
    return null;
  }
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
  } catch {
    // Keep the in-memory preference when persistent storage is unavailable.
  }
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
  // Store as JSON string for compatibility with older theme bundles that parsed this key.
  writeStorageItem(APPEARANCE_STORAGE_KEY, JSON.stringify(value));
}

function persistDefaultAppearance(value: Appearance) {
  writeStorageItem(APPEARANCE_DEFAULT_STORAGE_KEY, JSON.stringify(value));
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
  if (snapshot.resolvedAppearance !== merged.resolvedAppearance) {
    markThemeFlip();
  }
  snapshot = merged;
  applyResolvedAppearance(merged.resolvedAppearance);
  emit();
}

// Initialize at module load — before React renders — so the persisted appearance
// is on <html> ahead of first paint (no flash) and none of this runs during the
// render phase. The server-side default (when there's no explicit preference) is
// applied separately by the effect in usePreferences, which reads it from the
// shared React Query ["public"] cache instead of a duplicate fetch here.
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

  const refreshSystemAppearance = () => {
    if (snapshot.appearance === "system") {
      commit({ appearance: "system" });
    }
  };
  const mediaQuery = getSystemAppearanceMediaQuery();
  if (mediaQuery) {
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", refreshSystemAppearance);
    } else {
      mediaQuery.addListener(refreshSystemAppearance);
    }
  }
  window.addEventListener("focus", refreshSystemAppearance);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refreshSystemAppearance();
  });
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  initializeAppearance();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

function getSnapshot() {
  return snapshot;
}

export function usePreferences() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const themeSettings = useThemeSettings();

  useEffect(() => {
    if (hasExplicitAppearancePreference) return;
    const defaultAppearance = themeSettings.defaultAppearance;
    persistDefaultAppearance(defaultAppearance);
    commit({ appearance: defaultAppearance });
  }, [themeSettings.defaultAppearance]);

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
