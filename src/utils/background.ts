import type { Appearance } from "@/utils/themeSettings";

export type ResolvedAppearance = Exclude<Appearance, "system">;

export const DEFAULT_BACKGROUND_ALIGNMENT = "cover,center";
export const DEFAULT_SURFACE_OPACITY = 100;
export const SURFACE_SCRIM_THRESHOLD = 95;

const BACKGROUND_SIZE_VALUES = ["cover", "contain", "auto"] as const;
const BACKGROUND_POSITION_VALUES = ["top", "center", "bottom"] as const;

export type BackgroundSize = (typeof BACKGROUND_SIZE_VALUES)[number];
export type BackgroundPosition = (typeof BACKGROUND_POSITION_VALUES)[number];

const MAX_URL_LENGTH = 2048;
// 过滤可逃出 CSS url("…") 的字符
const UNSAFE_URL_CHARS = new RegExp("[\\x00-\\x1f\\x7f\"'`()<>\\\\\\s]", "g");

function sanitizeUrlPart(part: string): string {
  return part.replace(UNSAFE_URL_CHARS, "").slice(0, MAX_URL_LENGTH);
}

export function normalizeBackgroundUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  const parts = value.split("|").map((part) => sanitizeUrlPart(part.trim()));
  const light = parts[0] ?? "";
  const dark = parts[1] ?? "";
  if (dark && dark !== light) return `${light}|${dark}`;
  return light;
}

export function resolveBackgroundUrl(
  raw: string,
  appearance: ResolvedAppearance,
): string {
  if (!raw) return "";
  const parts = raw.split("|").map((part) => part.trim());
  if (parts.length >= 2) {
    return (appearance === "dark" ? parts[1] : parts[0]) ?? "";
  }
  return parts[0] ?? "";
}

export function parseBackgroundAlignment(value: unknown): {
  size: BackgroundSize;
  position: BackgroundPosition;
} {
  const fallback = { size: "cover" as BackgroundSize, position: "center" as BackgroundPosition };
  if (typeof value !== "string") return fallback;
  const [rawSize, rawPosition] = value.split(",").map((part) => part.trim().toLowerCase());
  const size = (BACKGROUND_SIZE_VALUES as readonly string[]).includes(rawSize)
    ? (rawSize as BackgroundSize)
    : fallback.size;
  const position = (BACKGROUND_POSITION_VALUES as readonly string[]).includes(rawPosition)
    ? (rawPosition as BackgroundPosition)
    : fallback.position;
  return { size, position };
}

export function normalizeBackgroundAlignment(value: unknown): string {
  const { size, position } = parseBackgroundAlignment(value);
  return `${size},${position}`;
}

export function normalizeSurfaceOpacity(value: unknown): number {
  const num =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseFloat(value)
        : Number.NaN;
  if (!Number.isFinite(num)) return DEFAULT_SURFACE_OPACITY;
  return Math.min(100, Math.max(0, Math.round(num)));
}

export function computeBackgroundScrim(opacity: unknown): number {
  const resolved = normalizeSurfaceOpacity(opacity);
  if (resolved >= SURFACE_SCRIM_THRESHOLD) return 0;
  const t = (SURFACE_SCRIM_THRESHOLD - resolved) / SURFACE_SCRIM_THRESHOLD;
  return Math.round(t * 16);
}

const BACKGROUND_CACHE_KEY = "lumina-plus:background";

interface BackgroundSettingsInput {
  enableBackgroundImage: boolean;
  enableMapBackground?: boolean;
  backgroundImage: string;
  backgroundImageMobile: string;
  backgroundAlignment: string;
  surfaceOpacity: number;
}

interface BackgroundCache {
  v: 2;
  mapBackground?: boolean;
  size: string;
  position: string;
  alpha: string;
  scrim: string;
  lightDesktop: string;
  lightMobile: string;
  darkDesktop: string;
  darkMobile: string;
}

function toCssUrl(url: string): string {
  return url ? `url("${url}")` : "none";
}

export function buildBackgroundCache(settings: BackgroundSettingsInput): BackgroundCache | null {
  const mapBackground = settings.enableMapBackground === true;
  if (!settings.enableBackgroundImage && !mapBackground) return null;
  const desktopImage = settings.enableBackgroundImage ? settings.backgroundImage : "";
  const mobileImage = settings.enableBackgroundImage ? settings.backgroundImageMobile : "";
  const lightDesktop = resolveBackgroundUrl(desktopImage, "light");
  const darkDesktop = resolveBackgroundUrl(desktopImage, "dark");
  const lightMobile = resolveBackgroundUrl(mobileImage, "light") || lightDesktop;
  const darkMobile = resolveBackgroundUrl(mobileImage, "dark") || darkDesktop;
  if (!lightDesktop && !darkDesktop && !lightMobile && !darkMobile && !mapBackground) return null;

  const { size, position } = parseBackgroundAlignment(settings.backgroundAlignment);
  const scrimPct = computeBackgroundScrim(settings.surfaceOpacity);
  return {
    v: 2,
    mapBackground,
    size,
    position,
    alpha: String(normalizeSurfaceOpacity(settings.surfaceOpacity)),
    scrim:
      scrimPct > 0
        ? `color-mix(in srgb, var(--bg-0) ${scrimPct}%, transparent)`
        : "",
    lightDesktop: toCssUrl(lightDesktop),
    lightMobile: toCssUrl(lightMobile),
    darkDesktop: toCssUrl(darkDesktop),
    darkMobile: toCssUrl(darkMobile),
  };
}

const BACKGROUND_VAR_NAMES = [
  "--bg-image-desktop",
  "--bg-image-mobile",
  "--bg-size",
  "--bg-position",
  "--surface-alpha",
  "--map-surface-alpha",
  "--bg-scrim",
] as const;

/** 将背景变量写入 `<html>`，须与 index.html 首帧脚本同步。 */
export function applyBackgroundCache(
  cache: BackgroundCache | null,
  appearance: ResolvedAppearance,
  options: {
    isMobile: boolean;
    isHomeDashboard?: boolean;
  },
): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (!cache) {
    for (const name of BACKGROUND_VAR_NAMES) root.style.removeProperty(name);
    return;
  }
  const dark = appearance === "dark";
  const desktop = dark ? cache.darkDesktop : cache.lightDesktop;
  const mobile = (dark ? cache.darkMobile : cache.lightMobile) || desktop;
  const selectedImage = options.isMobile ? mobile : desktop;
  const hasImage = selectedImage !== "none";
  const hasMap =
    !options.isMobile &&
    cache.mapBackground === true &&
    options.isHomeDashboard !== false;
  root.style.setProperty("--bg-image-desktop", desktop);
  root.style.setProperty("--bg-image-mobile", mobile);
  root.style.setProperty("--bg-size", cache.size);
  root.style.setProperty("--bg-position", cache.position);
  if (hasImage) {
    root.style.setProperty("--surface-alpha", cache.alpha);
    if (cache.scrim) root.style.setProperty("--bg-scrim", cache.scrim);
    else root.style.removeProperty("--bg-scrim");
  } else {
    root.style.removeProperty("--surface-alpha");
    root.style.removeProperty("--bg-scrim");
  }
  if (hasMap) root.style.setProperty("--map-surface-alpha", cache.alpha);
  else root.style.removeProperty("--map-surface-alpha");
}

export function persistBackgroundCache(cache: BackgroundCache | null): void {
  if (typeof localStorage === "undefined") return;
  try {
    if (cache) localStorage.setItem(BACKGROUND_CACHE_KEY, JSON.stringify(cache));
    else localStorage.removeItem(BACKGROUND_CACHE_KEY);
  } catch {
    // 忽略存储异常
  }
}
