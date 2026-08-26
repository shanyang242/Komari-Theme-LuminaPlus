import { describe, expect, it } from "vitest";
import {
  clampZoomWindow,
  FULL_ZOOM_WINDOW,
  isFullZoomWindow,
  panZoomWindow,
  rangeToZoomWindow,
  zoomWindowIndexRange,
  zoomWindowToRange,
} from "@/components/instance/chartZoom";

describe("clampZoomWindow", () => {
  it("把反向拖出来的窗口摆正", () => {
    expect(clampZoomWindow({ start: 0.8, end: 0.2 })).toEqual({ start: 0.2, end: 0.8 });
  });

  it("过窄的窗口以中点为锚展开到最小宽度", () => {
    const window = clampZoomWindow({ start: 0.5, end: 0.5 });

    expect(window.end - window.start).toBeCloseTo(0.02, 10);
    expect((window.start + window.end) / 2).toBeCloseTo(0.5, 10);
  });

  it("贴边的过窄窗口向内展开而不越界", () => {
    expect(clampZoomWindow({ start: 0, end: 0.001 })).toEqual({ start: 0, end: 0.02 });
    expect(clampZoomWindow({ start: 0.999, end: 1 })).toEqual({ start: 0.98, end: 1 });
  });

  it("非有限值退回全量窗口", () => {
    expect(clampZoomWindow({ start: Number.NaN, end: 1 })).toEqual(FULL_ZOOM_WINDOW);
  });
});

describe("zoomWindowToRange / rangeToZoomWindow", () => {
  it("比例与绝对区间可以来回换算", () => {
    const full: [number, number] = [1000, 2000];
    const window = { start: 0.25, end: 0.75 };

    expect(zoomWindowToRange(full, window)).toEqual([1250, 1750]);
    expect(rangeToZoomWindow(full, [1250, 1750])).toEqual(window);
  });

  it("零宽的完整轴不做换算", () => {
    expect(zoomWindowToRange([500, 500], { start: 0.2, end: 0.4 })).toEqual([500, 500]);
    expect(rangeToZoomWindow([500, 500], [500, 500])).toEqual(FULL_ZOOM_WINDOW);
  });
});

describe("panZoomWindow", () => {
  it("平移时保持窗口宽度", () => {
    const window = panZoomWindow({ start: 0.2, end: 0.4 }, 0.1);

    expect(window.start).toBeCloseTo(0.3, 10);
    expect(window.end).toBeCloseTo(0.5, 10);
  });

  it("碰到两端贴边停住而不压缩宽度", () => {
    const atStart = panZoomWindow({ start: 0.2, end: 0.4 }, -1);
    const atEnd = panZoomWindow({ start: 0.6, end: 0.8 }, 1);

    expect(atStart.start).toBe(0);
    expect(atStart.end).toBeCloseTo(0.2, 10);
    expect(atEnd.start).toBeCloseTo(0.8, 10);
    expect(atEnd.end).toBe(1);
  });
});

describe("isFullZoomWindow", () => {
  it("识别全量窗口", () => {
    expect(isFullZoomWindow(FULL_ZOOM_WINDOW)).toBe(true);
    expect(isFullZoomWindow({ start: 0, end: 0.9 })).toBe(false);
  });
});

describe("zoomWindowIndexRange", () => {
  it("返回落在区间内的首尾下标", () => {
    expect(zoomWindowIndexRange([10, 20, 30, 40, 50], [20, 40])).toEqual({
      fromIndex: 1,
      toIndex: 3,
    });
  });

  it("区间内没有点时返回空区间", () => {
    expect(zoomWindowIndexRange([10, 20], [100, 200])).toEqual({
      fromIndex: 0,
      toIndex: -1,
    });
    expect(zoomWindowIndexRange([], [0, 1])).toEqual({ fromIndex: 0, toIndex: -1 });
  });
});
