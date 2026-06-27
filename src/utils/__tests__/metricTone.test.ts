import { describe, expect, it } from "vitest";
import {
  latencyHeatColor,
  lossHeatColor,
  speedRateColor,
  speedRateColorFromBytes,
  trafficQuotaSegmentColor,
  trafficUsageColor,
} from "@/utils/metricTone";

function hue(color: string): number {
  const match = /^hsl\(([\d.]+)/.exec(color);
  if (!match) throw new Error(`not an hsl color: ${color}`);
  return Number(match[1]);
}

function oklchHue(color: string): number {
  const match = /^oklch\([\d.]+ [\d.]+ ([\d.]+)\)$/.exec(color);
  if (!match) throw new Error(`not an oklch color: ${color}`);
  return Number(match[1]);
}


describe("latencyHeatColor", () => {
  it("treats 0ms (sub-millisecond success) as the greenest latency, not neutral", () => {
    // 后端把往返 <1ms 取整成 0；0 是最优延迟,取最绿端(色相 ~145°),不能当无数据画成中性灰。
    const color = latencyHeatColor(0);
    expect(color).not.toBe("var(--text-tertiary)");
    expect(hue(color)).toBeCloseTo(145, 0);
  });

  it("returns neutral only for no data (null/undefined) or loss (negative / non-finite)", () => {
    expect(latencyHeatColor(null)).toBe("var(--text-tertiary)");
    expect(latencyHeatColor(undefined)).toBe("var(--text-tertiary)");
    expect(latencyHeatColor(-1)).toBe("var(--text-tertiary)");
    expect(latencyHeatColor(Number.NaN)).toBe("var(--text-tertiary)");
  });

  it("rotates hue green→red as latency grows", () => {
    expect(hue(latencyHeatColor(0))).toBeGreaterThan(hue(latencyHeatColor(120)));
    expect(hue(latencyHeatColor(120))).toBeGreaterThan(hue(latencyHeatColor(500)));
  });
});

describe("lossHeatColor", () => {
  it("treats 0% loss as the greenest, neutral only for negative / no data", () => {
    expect(hue(lossHeatColor(0))).toBeCloseTo(145, 0);
    expect(lossHeatColor(null)).toBe("var(--text-tertiary)");
    expect(lossHeatColor(-1)).toBe("var(--text-tertiary)");
  });
});

describe("trafficUsageColor", () => {
  it("returns the success token for no usage / unlimited / invalid", () => {
    expect(trafficUsageColor(0)).toBe("var(--status-success)");
    expect(trafficUsageColor(null)).toBe("var(--status-success)");
    expect(trafficUsageColor(Number.NaN)).toBe("var(--status-success)");
  });

  it("stays green while at least half the quota remains", () => {
    // used ≤ 50% 时处于绿色区(约 140–150°),健康配额不会被误显示成警告色
    expect(hue(trafficUsageColor(0.1))).toBeGreaterThan(140);
    expect(hue(trafficUsageColor(0.5))).toBeGreaterThan(140);
  });

  it("actually reaches red near the limit — the regression it fixes", () => {
    // 以前 85% 以下根本到不了红色(hue ≲ 15°),整个常用区间都只是绿→浅绿
    expect(hue(trafficUsageColor(0.95))).toBeLessThan(20);
    expect(hue(trafficUsageColor(1))).toBeLessThan(12);
  });

  it("warms monotonically (hue never increases) as usage climbs", () => {
    let prev = Number.POSITIVE_INFINITY;
    for (let f = 0.05; f <= 1.0001; f += 0.05) {
      const h = hue(trafficUsageColor(Math.min(f, 1)));
      expect(h).toBeLessThanOrEqual(prev + 1e-6);
      prev = h;
    }
  });
});

describe("trafficQuotaSegmentColor", () => {
  it("returns OKLCH and holds solid green across the short safe zone", () => {
    // 按位置取色,所以每段颜色固定、与填充量无关。绿色保持区很短(约 10%),避免绿色占主导,
    // 过了这段 hue 就往黄色下降
    expect(trafficQuotaSegmentColor(0)).toBe("oklch(0.7200 0.1600 150.00)");
    expect(trafficQuotaSegmentColor(0.05)).toBe("oklch(0.7200 0.1600 150.00)");
    expect(oklchHue(trafficQuotaSegmentColor(0.3))).toBeLessThan(128);
  });

  it("rotates the OKLCH hue green→yellow→orange→red so the zones stay distinct", () => {
    expect(oklchHue(trafficQuotaSegmentColor(0.03))).toBeGreaterThan(145); // 绿
    expect(oklchHue(trafficQuotaSegmentColor(0.44))).toBeGreaterThan(95); // 黄
    expect(oklchHue(trafficQuotaSegmentColor(0.44))).toBeLessThan(125);
    expect(oklchHue(trafficQuotaSegmentColor(0.72))).toBeLessThan(70); // 橙
    expect(oklchHue(trafficQuotaSegmentColor(1))).toBeLessThan(35); // 红
  });

  it("warms monotonically — OKLCH hue never rises with position", () => {
    let prev = Number.POSITIVE_INFINITY;
    for (let p = 0; p <= 1.0001; p += 0.05) {
      const h = oklchHue(trafficQuotaSegmentColor(Math.min(p, 1)));
      expect(h).toBeLessThanOrEqual(prev + 1e-6);
      prev = h;
    }
  });

  it("clamps positions outside 0..1", () => {
    expect(trafficQuotaSegmentColor(-1)).toBe(trafficQuotaSegmentColor(0));
    expect(trafficQuotaSegmentColor(2)).toBe(trafficQuotaSegmentColor(1));
  });
});

describe("speedRateColor", () => {
  it("maps each rate-unit tier to its own heat token (B→KB→MB→GB+)", () => {
    expect(speedRateColor("KB/s")).toBe("var(--speed-low)");
    expect(speedRateColor("MB/s")).toBe("var(--speed-high)");
    expect(speedRateColor("GB/s")).toBe("var(--speed-max)");
    // TB/s·PB/s 现实到不了,并入急速顶档(--speed-max)而非各占一档。
    expect(speedRateColor("TB/s")).toBe("var(--speed-max)");
    expect(speedRateColor("PB/s")).toBe("var(--speed-max)");
  });

  it("maps idle (B/s) to its own 超低速 tier, only unknown units go neutral", () => {
    expect(speedRateColor("B/s")).toBe("var(--speed-idle)");
    expect(speedRateColor("")).toBe("var(--text-tertiary)");
  });

  it("speedRateColorFromBytes routes raw bytes/sec through the unit tier", () => {
    expect(speedRateColorFromBytes(0)).toBe("var(--speed-idle)");
    expect(speedRateColorFromBytes(5 * 1024 * 1024)).toBe("var(--speed-high)");
  });
});
