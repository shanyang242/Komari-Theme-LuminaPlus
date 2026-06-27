import { clamp, toHsl, toOklch } from "@/utils/hsl";
import { formatByteRate } from "@/utils/format";

// latency 与 loss 共用同一套 5 段 HSL 热力渐变(绿=健康 → 黄 → 橙 → 红=危险),只是分档阈值不同。
// 每段把输入归一到 [0,1] 再在固定的色相/饱和/亮度斜坡上取值。
const HEAT_RAMP_SEGMENTS = [
  (t: number) => toHsl(145 - 18 * t, 62 + 8 * t, 48 + 3 * t),
  (t: number) => toHsl(127 - 47 * t, 70 + 6 * t, 51 + 1 * t),
  (t: number) => toHsl(80 - 30 * t, 76 + 6 * t, 52 + 1 * t),
  (t: number) => toHsl(50 - 20 * t, 82 + 4 * t, 53 - 1 * t),
  (t: number) => toHsl(30 - 24 * t, 86 - 2 * t, 52 - 8 * t),
];

// `bounds` 为前 4 段的上界(升序),`tailSpan` 是末段(最后上界往上)的归一化跨度。
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
  // 0ms 是亚毫秒成功探测(后端把往返 <1ms 取整成 0),属最优延迟、取最绿端;只有 null/负数/
  // 非有限值(无样本/丢包)才回退中性色。
  if (ms == null || !Number.isFinite(ms) || ms < 0) {
    return "var(--text-tertiary)";
  }
  return heatRamp(ms, [100, 150, 200, 300], 300);
}

// 流量配额条的用量热力色,按 used/limit 取值,但调成读作"还剩多少":剩 ≥50% 时纯绿,随着耗尽
// 从绿→琥珀,快用光时再琥珀→红。早先的曲线在整个常见区间都停在绿→黄绿,用量超 85% 才变红,危险信号
// 基本没出现过。风格与 latency/loss 渐变一致,让各卡片共用一套视觉语言。
export function trafficUsageColor(fraction: number | null | undefined): string {
  if (fraction == null || !Number.isFinite(fraction) || fraction <= 0) {
    return "var(--status-success)";
  }

  const f = clamp(fraction, 0, 1);

  // 剩 ≥50%:保持纯绿,健康的配额绝不读作警告。
  if (f <= 0.5) {
    const t = clamp(f / 0.5, 0, 1);
    return toHsl(150 - 6 * t, 58 + 4 * t, 46 + 2 * t);
  }

  // 剩 50%→22%:绿 → 琥珀。
  if (f <= 0.78) {
    const t = clamp((f - 0.5) / 0.28, 0, 1);
    return toHsl(144 - 104 * t, 62 + 20 * t, 48 + 4 * t);
  }

  // 剩 <22%:琥珀 → 红。
  const t = clamp((f - 0.78) / 0.22, 0, 1);
  return toHsl(40 - 34 * t, 82 + 4 * t, 52 - 6 * t);
}

// 分段流量配额条的位置热力色。`pos` 是某段在条上的绝对位置(0 = 最先用掉的字节,1 = 配额耗尽),
// 不是节点的实际用量——每段无论填没填都保持自己的色相,所以点亮的部分读作绿→琥珀→红,前缘表明配额
// 离用光还有多远。在 OKLCH(感知均匀空间)里插值,这样相等的位置步长在眼里也是相等的颜色步长,且没有
// 两个区段会混成一团(朴素 RGB 线性插值的毛病,绿和黄绿都还是绿)。色相旋转
// 绿(150°)→黄绿→黄(110°)→橙(62°)→红(27°),亮度在黄色处(本就最亮)达峰再向红色降下来,
// 让相邻段尽量拉开。短暂保持一段绿(约 10%)让健康配额看着平稳,又不让绿色喧宾夺主。大卡片把它们画成
// 干净的每段纯色块;紧凑卡片的 CSS 渐变(tokens.css 里的 --traffic-heat-spectrum)用 `in oklch`
// 插值镜像同一组色标。OKLCH 需要 2023+ 浏览器,与主题既有的 color-mix() 基线一致。
const TRAFFIC_QUOTA_STOPS = [
  { pos: 0, l: 0.72, c: 0.16, h: 150 }, // 绿
  { pos: 0.1, l: 0.72, c: 0.16, h: 150 }, // 保持绿(短)
  { pos: 0.28, l: 0.8, c: 0.18, h: 128 }, // 黄绿
  { pos: 0.44, l: 0.86, c: 0.18, h: 110 }, // 黄(亮度峰值)
  { pos: 0.58, l: 0.8, c: 0.18, h: 85 }, // 琥珀黄
  { pos: 0.72, l: 0.72, c: 0.19, h: 62 }, // 橙
  { pos: 0.86, l: 0.65, c: 0.21, h: 40 }, // 红橙
  { pos: 1, l: 0.6, c: 0.22, h: 27 }, // 红
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

// 速率按"现实可见的四档"着色,量级越大越"热"。单机网卡基本到不了 TB/s·PB/s,不再为它们各留一档,
// 而是把日常常见区间拆开:B/s 超低速(绿) → KB/s 低速(琥珀) → MB/s 高速(橙) → GB/s 及以上 急速(红)。
// GB/TB/PB 全并入急速顶档。挂机(B/s)归最低档保持有色,只有未知单位才回退中性色。
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

// 给只有原始字节/秒、没有现成 unit 的场景(如脉冲点):先取单位档再上色,把"字节速率→颜色"集中在一处。
export function speedRateColorFromBytes(bytesPerSec: number): string {
  return speedRateColor(formatByteRate(bytesPerSec).unit);
}

export function lossHeatColor(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(pct) || pct < 0) {
    return "var(--text-tertiary)";
  }
  return heatRamp(pct, [1, 3, 5, 10], 20);
}
