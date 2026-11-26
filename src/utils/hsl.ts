export { clamp } from "@/utils/format";

export function toHsl(h: number, s: number, l: number) {
  return `hsl(${h.toFixed(1)} ${s.toFixed(1)}% ${l.toFixed(1)}%)`;
}

// OKLCH(感知均匀)颜色字符串:l 取 0..1,c 是 chroma(约 0..0.4),h 为角度。需要 2023+ 浏览器,
// 与主题用 color-mix() 的基线一致。
export function toOklch(l: number, c: number, h: number) {
  return `oklch(${l.toFixed(4)} ${c.toFixed(4)} ${h.toFixed(2)})`;
}
