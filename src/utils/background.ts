import type { Appearance } from "@/utils/themeSettings";

export type ResolvedAppearance = Exclude<Appearance, "system">;

export const DEFAULT_BACKGROUND_ALIGNMENT = "cover,center";
export const DEFAULT_SURFACE_OPACITY = 100;
export const DEFAULT_BACKGROUND_VIDEO_URL =
  "/assets/LanternRivers_1080p15fps2Mbps3s.mp4";

// 低于此不透明度时才叠加背景可读性遮罩。
export const SURFACE_SCRIM_THRESHOLD = 95;

const BACKGROUND_SIZE_VALUES = ["cover", "contain", "auto"] as const;
const BACKGROUND_POSITION_VALUES = ["top", "center", "bottom"] as const;

export type BackgroundSize = (typeof BACKGROUND_SIZE_VALUES)[number];
export type BackgroundPosition = (typeof BACKGROUND_POSITION_VALUES)[number];

const MAX_URL_LENGTH = 2048;

// 移除可能逃出 CSS url("…") 上下文的字符；空格需由 URL 自身编码。
const UNSAFE_URL_CHARS = new RegExp("[\\x00-\\x1f\\x7f\"'`()<>\\\\\\s]", "g");
const EXPLICIT_SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

function sanitizeUrlPart(part: string): string {
  const cleaned = part.replace(UNSAFE_URL_CHARS, "").slice(0, MAX_URL_LENGTH);
  if (!cleaned || cleaned.startsWith("//")) return "";
  if (EXPLICIT_SCHEME_RE.test(cleaned)) {
    try {
      const parsed = new URL(cleaned);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    } catch {
      return "";
    }
  }
  return cleaned;
}

/** 规范化 `lightUrl|darkUrl`，清理两段 URL 并折叠相同值。 */
export function normalizeBackgroundUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  const parts = value.split("|").map((part) => sanitizeUrlPart(part.trim()));
  const light = parts[0] ?? "";
  const dark = parts[1] ?? "";
  if (dark && dark !== light) return `${light}|${dark}`;
  return light;
}

/** 编辑态校验每一段，避免安全归一化静默删除协议或截断输入。空段允许留空。 */
export function isBackgroundUrlValid(value: string): boolean {
  const parts = value.split("|").map((part) => part.trim());
  return parts.length <= 2 && parts.every((part) => !part || sanitizeUrlPart(part) === part);
}

/** 规范化单个视频 URL，拒绝非 HTTP(S) 与非站内路径。 */
export function normalizeBackgroundVideoUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  const part = value.trim();
  if (!part || part.length > MAX_URL_LENGTH || /[\x00-\x20\x7f\\|]/.test(part)) {
    return "";
  }

  if (part.startsWith("/")) return part.startsWith("//") ? "" : part;

  if (!/^https?:\/\//i.test(part)) return "";
  try {
    const parsed = new URL(part);
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      parsed.username ||
      parsed.password
    ) {
      return "";
    }
    return part;
  } catch {
    return "";
  }
}

export interface BackgroundVideoSourceInput {
  enabled: boolean;
  mediaType: "image" | "video";
  videoUrl: string;
  videoUrlDark: string;
  appearance: ResolvedAppearance;
  isMobile: boolean;
  reducedMotion: boolean;
  saveData: boolean;
}

/** 返回允许加载的桌面视频源；移动端与节能场景在设置 `src` 前直接截断。 */
export function resolveBackgroundVideoSource(input: BackgroundVideoSourceInput): string {
  if (
    !input.enabled ||
    input.mediaType !== "video" ||
    input.isMobile ||
    input.reducedMotion ||
    input.saveData
  ) {
    return "";
  }
  return input.appearance === "dark" ? input.videoUrlDark || input.videoUrl : input.videoUrl;
}

interface ReleasableVideo {
  pause: () => void;
  removeAttribute: (name: string) => void;
  load: () => void;
}

export function releaseBackgroundVideo(video: ReleasableVideo): void {
  video.pause();
  video.removeAttribute("src");
  video.load();
}

/** 从规范化的单 URL 或 `light|dark` 对中选择当前外观。 */
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

/** 由卡片不透明度推导 0–16% 的背景遮罩；高于阈值时不绘制。 */
export function computeBackgroundScrim(opacity: unknown): number {
  const resolved = normalizeSurfaceOpacity(opacity);
  if (resolved >= SURFACE_SCRIM_THRESHOLD) return 0;
  const t = (SURFACE_SCRIM_THRESHOLD - resolved) / SURFACE_SCRIM_THRESHOLD; // 取值 0–1
  return Math.round(t * 16);
}

// Legacy key retained so existing users keep their saved background after the rename.
const BACKGROUND_CACHE_KEY = "komaritheme:bg";

interface BackgroundSettingsInput {
  enableBackgroundImage: boolean;
  enableMapBackground?: boolean;
  backgroundMediaType: "image" | "video";
  backgroundImage: string;
  backgroundImageMobile: string;
  backgroundVideo: string;
  backgroundVideoDark: string;
  backgroundAlignment: string;
  surfaceOpacity: number;
}

/** 可直接写入 CSS 的首帧背景缓存。 */
interface BackgroundCache {
  v: 2;
  mapBackground?: boolean;
  desktopVideo: boolean;
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
  // 视频 URL 不进入首帧缓存；只记录视频模式，以便加载阶段隐藏桌面回退图。
  const mapBackground = settings.enableMapBackground === true;
  if (!settings.enableBackgroundImage && !mapBackground) return null;
  const desktopImage = settings.enableBackgroundImage ? settings.backgroundImage : "";
  const mobileImage = settings.enableBackgroundImage ? settings.backgroundImageMobile : "";
  const lightDesktop = resolveBackgroundUrl(desktopImage, "light");
  const darkDesktop = resolveBackgroundUrl(desktopImage, "dark");
  const lightMobile = resolveBackgroundUrl(mobileImage, "light") || lightDesktop;
  const darkMobile = resolveBackgroundUrl(mobileImage, "dark") || darkDesktop;
  const hasVideo =
    settings.enableBackgroundImage &&
    settings.backgroundMediaType === "video" &&
    Boolean(settings.backgroundVideo || settings.backgroundVideoDark);
  if (!lightDesktop && !darkDesktop && !lightMobile && !darkMobile && !hasVideo && !mapBackground) return null;

  const { size, position } = parseBackgroundAlignment(settings.backgroundAlignment);
  const scrimPct = computeBackgroundScrim(settings.surfaceOpacity);
  return {
    v: 2,
    mapBackground,
    desktopVideo: hasVideo,
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
  "--bg-scrim",
] as const;

/** 将缓存写入 `<html>`，与 index.html 的首帧逻辑保持一致。 */
export function applyBackgroundCache(
  cache: BackgroundCache | null,
  appearance: ResolvedAppearance,
  options: {
    isMobile: boolean;
    videoState?: "inactive" | "loading" | "playing" | "failed";
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
  const mobile = dark ? cache.darkMobile : cache.lightMobile;
  const videoState = options.videoState ?? "inactive";
  const suppressDesktopImage =
    !options.isMobile && (videoState === "loading" || videoState === "playing");
  const renderedDesktop = suppressDesktopImage ? "none" : desktop;
  const selectedImage = options.isMobile ? mobile : renderedDesktop;
  const videoIsPlaying = !options.isMobile && videoState === "playing";
  const active = videoIsPlaying || selectedImage !== "none" || (!options.isMobile && cache.mapBackground);
  root.style.setProperty("--bg-image-desktop", renderedDesktop);
  root.style.setProperty("--bg-image-mobile", mobile);
  root.style.setProperty("--bg-size", cache.size);
  root.style.setProperty("--bg-position", cache.position);
  if (active) {
    root.style.setProperty("--surface-alpha", cache.alpha);
    if (cache.scrim && (videoIsPlaying || selectedImage !== "none")) root.style.setProperty("--bg-scrim", cache.scrim);
    else root.style.removeProperty("--bg-scrim");
  } else {
    root.style.removeProperty("--surface-alpha");
    root.style.removeProperty("--bg-scrim");
  }
}

export function persistBackgroundCache(cache: BackgroundCache | null): void {
  if (typeof localStorage === "undefined") return;
  try {
    if (cache) localStorage.setItem(BACKGROUND_CACHE_KEY, JSON.stringify(cache));
    else localStorage.removeItem(BACKGROUND_CACHE_KEY);
  } catch {
    // 大不了下次首屏背景没缓存而已,非致命。
  }
}
