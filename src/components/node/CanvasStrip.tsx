import { useEffect, useRef, useState, type PointerEvent } from "react";

interface CanvasStripProps {
  className?: string;
  height: number;
  ariaHidden?: boolean;
  redrawKey?: string | number;
  draw: (ctx: CanvasRenderingContext2D, width: number, height: number) => void;
  getHoverIndex?: (offsetX: number, width: number) => number | null;
  onHoverIndex?: (index: number | null) => void;
}

// 解析 CSS 自定义属性要走 getComputedStyle(documentElement),会强制一次同步样式
// 重算。几十张卡片每个 realtime tick 各画好几张 canvas 时,这是渲染开销的大头,
// 所以按主题缓存结果。缓存以 appearance dataset 为 key(读取廉价、不触发 reflow),
// 主题切换时清空。
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
  dark: {
    "--progress-bg": "#26262a",
    "--progress-cpu": "#5d88ff",
    "--progress-memory": "#a35cf5",
    "--progress-disk": "#f1873d",
    "--progress-network": "#5bbb8a",
    "--progress-load": "#f472b6",
    "--speed-idle": "#61c08f",
    "--speed-low": "#e0b34f",
    "--speed-high": "#ef8f55",
    "--speed-max": "#ec6a5e",
    "--status-success": "#61c08f",
    "--status-warning": "#d4a54a",
    "--status-error": "#d84e45",
    "--status-info": "#5d88ff",
    "--status-online": "#61c08f",
    "--status-offline": "#d84e45",
    "--text-tertiary": "#76767c",
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

// 用户改了自定义指标配色时，颜色没换明暗模式，appearance-key 不会触发上面的失效逻辑，
// canvas 会继续画缓存里的旧色。改色后由 useMetricColors 调这个手动清缓存，下次重绘读到新值。
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
  // 只缓存真正解析到的值。空串说明样式表还没生效(如首帧),缓存它会让 canvas 一直
  // 画原始 `var(...)` 串(fillStyle 拒绝 → 不可见),直到主题切换。样式就绪后下一帧
  // 重新解析很廉价。
  if (resolved) cssColorCache.set(varName, resolved);
  return resolved || color;
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

function parseHexColor(color: string): { r: number; g: number; b: number } | null {
  const value = color.trim();
  const short = /^#([\da-f])([\da-f])([\da-f])$/i.exec(value);
  if (short) {
    return {
      r: parseInt(`${short[1]}${short[1]}`, 16),
      g: parseInt(`${short[2]}${short[2]}`, 16),
      b: parseInt(`${short[3]}${short[3]}`, 16),
    };
  }
  const full = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(value);
  if (full) {
    return {
      r: parseInt(full[1], 16),
      g: parseInt(full[2], 16),
      b: parseInt(full[3], 16),
    };
  }
  return null;
}

// 等价于 `color-mix(in srgb, baseColor <w*100>%, white <(1-w)*100>%)`,返回 rgb()
// 串。之所以自己算而不直接把 `color-mix()` 串丢给 canvas:老 WebKit(Safari < 16.2)
// 无法把 color-mix() 当 canvas 颜色解析,会抛 "The string did not match the expected
// pattern."。sRGB 混合就是对 0–255 通道做逐通道 lerp,各浏览器结果都和 color-mix
// 完全一致。解析不出 hex 时原样返回 baseColor(仍是合法 canvas 颜色)。
export function mixSrgbTowardWhite(baseColor: string, baseWeight: number): string {
  const rgb = parseHexColor(baseColor);
  if (!rgb) return baseColor;
  const w = Math.max(0, Math.min(1, baseWeight));
  const channel = (value: number) => Math.round(value * w + 255 * (1 - w));
  return `rgb(${channel(rgb.r)}, ${channel(rgb.g)}, ${channel(rgb.b)})`;
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

// 所有交给 canvas 的颜色都过这一个收口。老 WebKit(Safari < 16)无法把现代颜色语法
// 当 canvas 颜色解析,会抛 "The string did not match the expected pattern."——所以这里
// 解析 `var(...)`,并把 `hsl()`(toHsl 输出的现代空格分隔形式)改写成 `rgb()`。再统一
// 拿当前 canvas 实现校验;不支持或仍未解析的颜色回退到已知的主题 hex 值,而不是带着它
// 走到 addColorStop/fillStyle 把老 WebKit 搞崩。
export function safeCanvasColor(color: string): string {
  const varName = extractCssVarName(color);
  const value = (varName ? resolveCssColor(color) : color).trim();
  if (!value || /^var\(/i.test(value) || /^color-mix\(/i.test(value)) {
    return fallbackCanvasColor(varName);
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

export function CanvasStrip({
  className,
  height,
  ariaHidden = false,
  redrawKey,
  draw,
  getHoverIndex,
  onHoverIndex,
}: CanvasStripProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastHoverIndexRef = useRef<number | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const updateWidth = () => {
      setWidth(canvas.clientWidth);
    };

    updateWidth();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateWidth);
      return () => window.removeEventListener("resize", updateWidth);
    }

    const observer = new ResizeObserver(() => {
      updateWidth();
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    draw(ctx, width, height);
  }, [draw, height, redrawKey, width]);

  const handlePointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!getHoverIndex || !onHoverIndex || width <= 0) return;
    const next = getHoverIndex(event.nativeEvent.offsetX, width);
    if (next === lastHoverIndexRef.current) return;
    lastHoverIndexRef.current = next;
    onHoverIndex(next);
  };

  const handlePointerLeave = () => {
    if (lastHoverIndexRef.current === null) return;
    lastHoverIndexRef.current = null;
    onHoverIndex?.(null);
  };

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width: "100%", height }}
      aria-hidden={ariaHidden}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
    />
  );
}
