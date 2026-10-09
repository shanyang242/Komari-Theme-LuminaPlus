import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent,
} from "react";
import { supportsFineHover } from "@/utils/mediaQuery";

export interface CanvasStripInteraction {
  hoverIndex: number | null;
  hoverProgress: number;
}

interface CanvasStripProps {
  className?: string;
  height: number;
  redrawKey?: string | number;
  draw: (
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    interaction: CanvasStripInteraction,
  ) => void;
  getHoverIndex?: (offsetX: number, width: number) => number | null;
  onHoverIndex?: (index: number | null) => void;
}

type WidthListener = (width: number) => void;
type VisibilityListener = (visible: boolean) => void;

const observedWidths = new Map<Element, WidthListener>();
let sharedResizeObserver: ResizeObserver | null = null;
const observedVisibility = new Map<Element, VisibilityListener>();
let sharedIntersectionObserver: IntersectionObserver | null = null;

function normalizeWidth(width: number) {
  return Number.isFinite(width) && width > 0 ? Math.round(width * 100) / 100 : 0;
}

function subscribeToWidth(element: HTMLElement, listener: WidthListener) {
  sharedResizeObserver ??= new ResizeObserver((entries) => {
    for (const entry of entries) {
      observedWidths.get(entry.target)?.(normalizeWidth(entry.contentRect.width));
    }
  });
  observedWidths.set(element, listener);
  sharedResizeObserver.observe(element);

  return () => {
    observedWidths.delete(element);
    sharedResizeObserver?.unobserve(element);
    if (observedWidths.size === 0) {
      sharedResizeObserver?.disconnect();
      sharedResizeObserver = null;
    }
  };
}

function subscribeToVisibility(element: HTMLElement, listener: VisibilityListener) {
  sharedIntersectionObserver ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        observedVisibility.get(entry.target)?.(entry.isIntersecting);
      }
    },
    { rootMargin: "160px 0px" },
  );
  observedVisibility.set(element, listener);
  sharedIntersectionObserver.observe(element);

  return () => {
    observedVisibility.delete(element);
    sharedIntersectionObserver?.unobserve(element);
    if (observedVisibility.size === 0) {
      sharedIntersectionObserver?.disconnect();
      sharedIntersectionObserver = null;
    }
  };
}

// 缓存 CSS 变量，避免每张卡片每次重绘都触发样式计算。
const cssColorCache = new Map<string, string>();
let cssColorCacheKey: string | null = null;
let colorValidationContext: CanvasRenderingContext2D | null | undefined;

const CANVAS_COLOR_FALLBACKS = {
  light: {
    "--progress-bg": "#e4e4e7",
    "--progress-cpu": "#3b82f6",
    "--progress-memory": "#8b5cf6",
    "--progress-disk": "#e97b35",
    "--progress-network": "#10b981",
    "--progress-load": "#ec4899",
    "--progress-swap": "#6366f1",
    "--traffic-up": "#3b82f6",
    "--traffic-down": "#2f9e65",
    "--speed-idle": "#3aa76a",
    "--speed-low": "#d9992b",
    "--speed-high": "#e07a35",
    "--speed-max": "#d6463d",
    "--status-success": "#2f9e65",
    "--status-warning": "#e9a23b",
    "--status-error": "#dc2626",
    "--status-info": "#3b82f6",
    "--status-online": "#2f9e65",
    "--status-offline": "#dc2626",
    "--text-tertiary": "#71717a",
  },
  // 与 tokens.css 深色 token 保持同值(color-mix 变量取 depth=0 的基色),只在首帧/样式
  // 未就绪时命中,避免回退色与 DOM 侧漂移。
  dark: {
    "--progress-bg": "#343b45",
    "--progress-cpu": "#539bf5",
    "--progress-memory": "#b083f0",
    "--progress-disk": "#e0823d",
    "--progress-network": "#57ab5a",
    "--progress-load": "#e275ad",
    "--progress-swap": "#986ee2",
    "--traffic-up": "#539bf5",
    "--traffic-down": "#57ab5a",
    "--speed-idle": "#57ab5a",
    "--speed-low": "#daaa3f",
    "--speed-high": "#e0823d",
    "--speed-max": "#f47067",
    "--status-success": "#57ab5a",
    "--status-warning": "#daaa3f",
    "--status-error": "#f47067",
    "--status-info": "#539bf5",
    "--status-online": "#57ab5a",
    "--status-offline": "#f47067",
    "--text-tertiary": "#9198a1",
  },
} as const;

function extractCssVarName(color: string): string | null {
  return color.match(/^var\((--[^),\s]+)/)?.[1] ?? null;
}

function fallbackCanvasColor(varName: string | null): string {
  if (!varName) return "#000000";
  const appearance = document.documentElement.dataset.appearance === "dark" ? "dark" : "light";
  return CANVAS_COLOR_FALLBACKS[appearance][
    varName as keyof (typeof CANVAS_COLOR_FALLBACKS)["light"]
  ] ?? "#000000";
}

// 自定义配色不改变 appearance，需要显式失效。
export function clearCssColorCache() {
  cssColorCache.clear();
  cssColorCacheKey = null;
}

function resolveCssColor(color: string): string {
  const varName = extractCssVarName(color);
  if (!varName) return color;

  const appearance = document.documentElement.dataset.appearance ?? "";
  if (appearance !== cssColorCacheKey) {
    cssColorCacheKey = appearance;
    cssColorCache.clear();
  }

  const cached = cssColorCache.get(varName);
  if (cached !== undefined) return cached || color;

  const resolved = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  // 首帧空值不缓存，样式就绪后可重新解析。
  if (resolved) cssColorCache.set(varName, resolved);
  return resolved || color;
}

// canvas 的颜色解析器不认 color-mix()/calc()(如深色 --progress-bg 随 --dark-depth 混色),
// 借 DOM 的 color 属性让 CSS 引擎算成 rgb。键含替换后的变量值,深度/配色一变即天然失效。
let cssEngineProbe: HTMLElement | null = null;
const cssEngineColorCache = new Map<string, string | null>();

function resolveWithCssEngine(value: string): string | null {
  if (typeof document === "undefined") return null;
  const cached = cssEngineColorCache.get(value);
  if (cached !== undefined) return cached;
  if (!cssEngineProbe) {
    cssEngineProbe = document.createElement("span");
    cssEngineProbe.style.display = "none";
    document.documentElement.appendChild(cssEngineProbe);
  }
  cssEngineProbe.style.color = "";
  cssEngineProbe.style.color = value;
  const resolved = cssEngineProbe.style.color
    ? getComputedStyle(cssEngineProbe).color.trim() || null
    : null;
  cssEngineColorCache.set(value, resolved);
  return resolved;
}

function canUseCanvasColor(color: string): boolean {
  if (typeof document === "undefined") return true;
  try {
    if (colorValidationContext === undefined) {
      colorValidationContext = document.createElement("canvas").getContext("2d");
    }
    const ctx = colorValidationContext;
    if (!ctx) return true;

    ctx.fillStyle = "#000001";
    ctx.fillStyle = color;
    if (ctx.fillStyle !== "#000001") return true;

    ctx.fillStyle = "#000002";
    ctx.fillStyle = color;
    return ctx.fillStyle !== "#000002";
  } catch {
    return false;
  }
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const sat = Math.max(0, Math.min(1, s / 100));
  const lig = Math.max(0, Math.min(1, l / 100));
  const c = (1 - Math.abs(2 * lig - 1)) * sat;
  const hp = ((((h % 360) + 360) % 360)) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const m = lig - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

// 统一解析并校验 Canvas 颜色，不支持时回退到主题色。
export function safeCanvasColor(color: string): string {
  const varName = extractCssVarName(color);
  let value = (varName ? resolveCssColor(color) : color).trim();
  if (!value || /^var\(/i.test(value)) {
    return fallbackCanvasColor(varName);
  }
  if (/color-mix\(|calc\(/i.test(value)) {
    const resolved = resolveWithCssEngine(value);
    if (!resolved) return fallbackCanvasColor(varName);
    value = resolved;
  }

  const hsl = /^hsla?\(([^)]+)\)$/i.exec(value);
  if (hsl) {
    const parts = hsl[1]
      .replace(/\//g, " ")
      .split(/[\s,]+/)
      .filter(Boolean)
      .map((part) => parseFloat(part));
    if (parts.length >= 3 && parts.slice(0, 3).every((n) => Number.isFinite(n))) {
      const { r, g, b } = hslToRgb(parts[0], parts[1], parts[2]);
      return `rgb(${r}, ${g}, ${b})`;
    }
  }
  if (!canUseCanvasColor(value)) return fallbackCanvasColor(varName);
  return value;
}

export function fillRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const safeRadius = Math.max(0, Math.min(radius, width / 2, height / 2));
  ctx.beginPath();
  ctx.moveTo(x + safeRadius, y);
  ctx.lineTo(x + width - safeRadius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  ctx.lineTo(x + width, y + height - safeRadius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  ctx.lineTo(x + safeRadius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  ctx.lineTo(x, y + safeRadius);
  ctx.quadraticCurveTo(x, y, x + safeRadius, y);
  ctx.closePath();
  ctx.fill();
}

// 拖到不同缩放比的显示器时 DPR 会在 CSS 宽度不变的情况下变化,位图必须按新 DPR 重建,
// 否则整条发虚。matchMedia 的 resolution 查询只在离开当前值时触发一次,变化后要重新
// 绑定新值的查询;所有 CanvasStrip 共享一个监听。
const dprListeners = new Set<() => void>();
let dprQuery: MediaQueryList | null = null;

function currentDpr() {
  if (typeof window === "undefined") return 1;
  const value = window.devicePixelRatio;
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function handleDprChange() {
  dprQuery?.removeEventListener("change", handleDprChange);
  bindDprQuery();
  for (const listener of dprListeners) listener();
}

function bindDprQuery() {
  dprQuery = window.matchMedia(`(resolution: ${currentDpr()}dppx)`);
  dprQuery.addEventListener("change", handleDprChange);
}

function subscribeToDpr(listener: () => void) {
  dprListeners.add(listener);
  if (dprListeners.size === 1) bindDprQuery();
  return () => {
    dprListeners.delete(listener);
    if (dprListeners.size === 0) {
      dprQuery?.removeEventListener("change", handleDprChange);
      dprQuery = null;
    }
  };
}

export function CanvasStrip({
  className,
  height,
  redrawKey,
  draw,
  getHoverIndex,
  onHoverIndex,
}: CanvasStripProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastHoverIndexRef = useRef<number | null>(null);
  const hoverAnimationFrameRef = useRef<number | null>(null);
  const interactionRef = useRef<CanvasStripInteraction>({ hoverIndex: null, hoverProgress: 0 });
  const [interaction, setInteraction] = useState<CanvasStripInteraction>(interactionRef.current);
  const [width, setWidth] = useState(0);
  const [visible, setVisible] = useState(false);
  const dpr = useSyncExternalStore(subscribeToDpr, currentDpr, () => 1);

  const commitInteraction = (next: CanvasStripInteraction) => {
    interactionRef.current = next;
    setInteraction(next);
  };

  const animateHover = (hoverIndex: number | null, target: 0 | 1) => {
    if (hoverAnimationFrameRef.current != null) {
      cancelAnimationFrame(hoverAnimationFrameRef.current);
      hoverAnimationFrameRef.current = null;
    }

    const current = interactionRef.current;
    // 横向扫过相邻柱时沿用当前强度，避免每跨一格都从 0 开始造成闪烁。
    const startProgress = current.hoverProgress;
    const start = performance.now();
    const duration = 150 * Math.abs(target - startProgress);
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

    if (reduceMotion || duration <= 0) {
      commitInteraction({ hoverIndex: target === 0 ? null : hoverIndex, hoverProgress: target });
      return;
    }

    commitInteraction({ hoverIndex, hoverProgress: startProgress });
    const tick = (now: number) => {
      const elapsed = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - elapsed, 3);
      const hoverProgress = startProgress + (target - startProgress) * eased;
      const done = elapsed >= 1;
      commitInteraction({
        hoverIndex: done && target === 0 ? null : hoverIndex,
        hoverProgress: done ? target : hoverProgress,
      });
      hoverAnimationFrameRef.current = done ? null : requestAnimationFrame(tick);
    };
    hoverAnimationFrameRef.current = requestAnimationFrame(tick);
  };

  useEffect(
    () => () => {
      if (hoverAnimationFrameRef.current != null) {
        cancelAnimationFrame(hoverAnimationFrameRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const updateWidth = (nextWidth: number) => {
      setWidth((current) => (current === nextWidth ? current : nextWidth));
    };

    const unsubscribeWidth = subscribeToWidth(canvas, updateWidth);
    const unsubscribeVisibility = subscribeToVisibility(canvas, setVisible);
    return () => {
      unsubscribeWidth();
      unsubscribeVisibility();
    };
  }, []);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !visible || width <= 0) return;

    const pixelWidth = Math.max(1, Math.round(width * dpr));
    const pixelHeight = Math.max(1, Math.round(height * dpr));

    // 重设 canvas 尺寸会清空状态并重新分配位图；数据重绘时尺寸通常没有变化。
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, width, height);
    draw(ctx, width, height, interaction);
  }, [dpr, draw, height, interaction, redrawKey, visible, width]);

  const handlePointerLeave = () => {
    if (lastHoverIndexRef.current === null) return;
    const previous = lastHoverIndexRef.current;
    lastHoverIndexRef.current = null;
    animateHover(previous, 0);
    onHoverIndex?.(null);
  };

  const handlePointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!supportsFineHover(event.pointerType)) {
      if (lastHoverIndexRef.current !== null) handlePointerLeave();
      return;
    }
    if (!getHoverIndex || width <= 0) return;
    const next = getHoverIndex(event.nativeEvent.offsetX, width);
    if (next === lastHoverIndexRef.current) return;
    lastHoverIndexRef.current = next;
    animateHover(next, next == null ? 0 : 1);
    onHoverIndex?.(next);
  };

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width: "100%", height }}
      aria-hidden
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
    />
  );
}
