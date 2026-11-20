export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function toHsl(h: number, s: number, l: number) {
  return `hsl(${h.toFixed(1)} ${s.toFixed(1)}% ${l.toFixed(1)}%)`;
}

export function toOklch(l: number, c: number, h: number) {
  return `oklch(${l.toFixed(4)} ${c.toFixed(4)} ${h.toFixed(2)})`;
}
