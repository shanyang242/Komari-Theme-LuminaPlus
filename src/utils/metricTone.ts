import { clamp, toHsl, toOklch } from "@/utils/hsl";
import { formatByteRate } from "@/utils/format";

const HEAT_RAMP_SEGMENTS = [
  (t: number) => toHsl(145 - 18 * t, 62 + 8 * t, 48 + 3 * t),
  (t: number) => toHsl(127 - 47 * t, 70 + 6 * t, 51 + 1 * t),
  (t: number) => toHsl(80 - 30 * t, 76 + 6 * t, 52 + 1 * t),
  (t: number) => toHsl(50 - 20 * t, 82 + 4 * t, 53 - 1 * t),
  (t: number) => toHsl(30 - 24 * t, 86 - 2 * t, 52 - 8 * t),
];

function heatRamp(
  value: number,
  bounds: [number, number, number, number],
  tailSpan: number,
): string {
  const [b0, b1, b2, b3] = bounds;
  if (value <= b0) return HEAT_RAMP_SEGMENTS[0](clamp(value / b0, 0, 1));
  if (value <= b1) return HEAT_RAMP_SEGMENTS[1](clamp((value - b0) / (b1 - b0), 0, 1));
  if (value <= b2) return HEAT_RAMP_SEGMENTS[2](clamp((value - b1) / (b2 - b1), 0, 1));
  if (value <= b3) return HEAT_RAMP_SEGMENTS[3](clamp((value - b2) / (b3 - b2), 0, 1));
  return HEAT_RAMP_SEGMENTS[4](clamp((value - b3) / tailSpan, 0, 1));
}

export function latencyHeatColor(ms: number | null | undefined): string {
  // 0ms 为亚毫秒成功探测
  if (ms == null || !Number.isFinite(ms) || ms < 0) {
    return "var(--text-tertiary)";
  }
  if (ms <= 60) return "var(--latency-excellent)";
  if (ms <= 100) return "var(--latency-good)";
  if (ms <= 160) return "var(--latency-moderate)";
  if (ms <= 200) return "var(--latency-elevated)";
  return "var(--latency-critical)";
}

export function trafficUsageColor(fraction: number | null | undefined): string {
  if (fraction == null || !Number.isFinite(fraction) || fraction <= 0) {
    return "var(--status-success)";
  }

  const f = clamp(fraction, 0, 1);

  if (f <= 0.5) {
    const t = clamp(f / 0.5, 0, 1);
    return toHsl(150 - 6 * t, 58 + 4 * t, 46 + 2 * t);
  }

  if (f <= 0.78) {
    const t = clamp((f - 0.5) / 0.28, 0, 1);
    return toHsl(144 - 104 * t, 62 + 20 * t, 48 + 4 * t);
  }

  const t = clamp((f - 0.78) / 0.22, 0, 1);
  return toHsl(40 - 34 * t, 82 + 4 * t, 52 - 6 * t);
}

// 与 tokens.css 的 --traffic-heat-spectrum 色标同步
const TRAFFIC_QUOTA_STOPS = [
  { pos: 0, l: 0.72, c: 0.16, h: 150 },
  { pos: 0.1, l: 0.72, c: 0.16, h: 150 },
  { pos: 0.28, l: 0.8, c: 0.18, h: 128 },
  { pos: 0.44, l: 0.86, c: 0.18, h: 110 },
  { pos: 0.58, l: 0.8, c: 0.18, h: 85 },
  { pos: 0.72, l: 0.72, c: 0.19, h: 62 },
  { pos: 0.86, l: 0.65, c: 0.21, h: 40 },
  { pos: 1, l: 0.6, c: 0.22, h: 27 },
];

export function trafficQuotaSegmentColor(pos: number): string {
  const p = clamp(pos, 0, 1);
  for (let i = 0; i < TRAFFIC_QUOTA_STOPS.length - 1; i++) {
    const a = TRAFFIC_QUOTA_STOPS[i];
    const b = TRAFFIC_QUOTA_STOPS[i + 1];
    if (p >= a.pos && p <= b.pos) {
      const t = b.pos === a.pos ? 0 : (p - a.pos) / (b.pos - a.pos);
      return toOklch(a.l + (b.l - a.l) * t, a.c + (b.c - a.c) * t, a.h + (b.h - a.h) * t);
    }
  }
  return toOklch(0.6, 0.22, 27);
}

const SPEED_RATE_COLOR: Record<string, string> = {
  "B/s": "var(--speed-idle)",
  "KB/s": "var(--speed-low)",
  "MB/s": "var(--speed-high)",
  "GB/s": "var(--speed-max)",
  "TB/s": "var(--speed-max)",
  "PB/s": "var(--speed-max)",
};

export function speedRateColor(unit: string): string {
  return SPEED_RATE_COLOR[unit] ?? "var(--text-tertiary)";
}

export function speedRateColorFromBytes(bytesPerSec: number): string {
  return speedRateColor(formatByteRate(bytesPerSec).unit);
}

export function lossHeatColor(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(pct) || pct < 0) {
    return "var(--text-tertiary)";
  }
  return heatRamp(pct, [1, 3, 5, 10], 20);
}
