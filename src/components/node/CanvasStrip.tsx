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

// Resolving a CSS custom property requires getComputedStyle(documentElement),
// which forces a synchronous style recalc. With dozens of cards each drawing
// several canvases per realtime tick this dominated render cost, so results are
// cached per theme. The cache is keyed on the appearance dataset (read is cheap
// and reflow-free) and cleared whenever the theme flips.
const cssColorCache = new Map<string, string>();
let cssColorCacheKey: string | null = null;

export function resolveCssColor(color: string): string {
  const match = color.match(/^var\((--[^),\s]+)/);
  if (!match) return color;

  const appearance = document.documentElement.dataset.appearance ?? "";
  if (appearance !== cssColorCacheKey) {
    cssColorCacheKey = appearance;
    cssColorCache.clear();
  }

  const varName = match[1];
  const cached = cssColorCache.get(varName);
  if (cached !== undefined) return cached || color;

  const resolved = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  // Only cache a real resolution. An empty string means the stylesheet was not
  // applied yet (e.g. first paint); caching it would leave canvases drawing the
  // raw `var(...)` string (which fillStyle rejects → invisible) until the theme
  // flips. Re-resolving next frame is cheap once styles are ready.
  if (resolved) cssColorCache.set(varName, resolved);
  return resolved || color;
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

// JS equivalent of `color-mix(in srgb, baseColor <w*100>%, white <(1-w)*100>%)`,
// returning an rgb() string. Computed here instead of handing a `color-mix()`
// string to the canvas because old WebKit (Safari < 16.2) can't parse color-mix()
// as a canvas color and throws "The string did not match the expected pattern.".
// sRGB mixing is a plain per-channel lerp on the 0–255 values, so the result is
// numerically identical to color-mix on every browser. Falls back to the base
// color unchanged when it isn't a hex we can parse (still a valid canvas color).
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

// Single chokepoint for every color handed to a canvas. Old WebKit (Safari < 16)
// can't parse modern color syntaxes as a canvas color and throws "The string did
// not match the expected pattern." — so resolve `var(...)` and rewrite `hsl()`
// (which toHsl emits in the modern space-separated form) to `rgb()`. Hex / rgb()
// pass through; anything else is returned as-is (we no longer produce color-mix()).
export function safeCanvasColor(color: string): string {
  const value = (color.startsWith("var(") ? resolveCssColor(color) : color).trim();
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
