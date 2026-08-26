import { describe, expect, it } from "vitest";
import { buildPingSeriesOverlay } from "@/components/instance/pingChartOverlay";

describe("buildPingSeriesOverlay", () => {
  it("只把 null 当丢包，跨过 off-phase 的 undefined", () => {
    const overlay = buildPingSeriesOverlay([10, null, undefined, 20, null], "#f00");

    expect(overlay.lossIndices).toEqual([1, 4]);
    expect(overlay.max).toEqual({ index: 3, value: 20 });
    expect(overlay.min).toEqual({ index: 0, value: 10 });
  });

  it("把 0ms 当有效的亚毫秒探测而非缺失", () => {
    const overlay = buildPingSeriesOverlay([0, 5], "#f00");

    expect(overlay.min).toEqual({ index: 0, value: 0 });
    expect(overlay.lossIndices).toEqual([]);
  });

  it("极值落在同一点时只保留 max，避免两个 pin 重叠", () => {
    const overlay = buildPingSeriesOverlay([undefined, 7, undefined], "#f00");

    expect(overlay.max).toEqual({ index: 1, value: 7 });
    expect(overlay.min).toBeNull();
  });

  it("几乎全丢时抑制竖线，避免绘图区被涂满", () => {
    const values = Array.from({ length: 20 }, () => null);

    expect(buildPingSeriesOverlay(values, "#f00").lossIndices).toEqual([]);
  });

  it("样本过少时不启用抑制，单次丢包仍要画出来", () => {
    const overlay = buildPingSeriesOverlay([null], "#f00");

    expect(overlay.lossIndices).toEqual([0]);
  });

  it("限定区间时只统计区间内的点", () => {
    const overlay = buildPingSeriesOverlay([999, null, 10, 50, null, 1], "#f00", {
      fromIndex: 2,
      toIndex: 4,
    });

    expect(overlay.lossIndices).toEqual([4]);
    expect(overlay.max).toEqual({ index: 3, value: 50 });
    expect(overlay.min).toEqual({ index: 2, value: 10 });
  });
});
