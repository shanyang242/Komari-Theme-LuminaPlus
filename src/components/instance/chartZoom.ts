// 图表横向缩放窗口。以「占完整时间轴的比例」表达，而不是绝对时间戳：
// 刷新拿到新数据、切换时间范围后，窗口仍然指向同一段相对区间，不需要重新换算。

export interface ChartZoomWindow {
  start: number;
  end: number;
}

export type ChartRange = readonly [number, number];

export const FULL_ZOOM_WINDOW: ChartZoomWindow = { start: 0, end: 1 };

// 最窄可缩放到整段的 2%：再窄下去 uPlot 的 x scale 会退化成几乎零宽，
// 坐标轴刻度和 tooltip 定位都会失真。
const MIN_ZOOM_SPAN = 0.02;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function clampZoomWindow(window: ChartZoomWindow): ChartZoomWindow {
  if (!Number.isFinite(window.start) || !Number.isFinite(window.end)) {
    return FULL_ZOOM_WINDOW;
  }
  const start = clamp(Math.min(window.start, window.end), 0, 1);
  const end = clamp(Math.max(window.start, window.end), 0, 1);
  if (end - start >= MIN_ZOOM_SPAN) return { start, end };

  // 宽度不足时以中点为锚展开到最小宽度，再整体推回 [0, 1] 内。
  const center = (start + end) / 2;
  const half = MIN_ZOOM_SPAN / 2;
  if (center - half < 0) return { start: 0, end: MIN_ZOOM_SPAN };
  if (center + half > 1) return { start: 1 - MIN_ZOOM_SPAN, end: 1 };
  return { start: center - half, end: center + half };
}

export function isFullZoomWindow(window: ChartZoomWindow): boolean {
  return window.start <= 0 && window.end >= 1;
}

export function zoomWindowToRange(
  full: ChartRange,
  window: ChartZoomWindow,
): [number, number] {
  const span = full[1] - full[0];
  if (!(span > 0)) return [full[0], full[1]];
  return [full[0] + span * window.start, full[0] + span * window.end];
}

export function rangeToZoomWindow(
  full: ChartRange,
  range: ChartRange,
): ChartZoomWindow {
  const span = full[1] - full[0];
  if (!(span > 0)) return FULL_ZOOM_WINDOW;
  return clampZoomWindow({
    start: (range[0] - full[0]) / span,
    end: (range[1] - full[0]) / span,
  });
}

/** 保持窗口宽度不变地平移；碰到两端就贴边停住。 */
export function panZoomWindow(
  window: ChartZoomWindow,
  deltaRatio: number,
): ChartZoomWindow {
  const span = window.end - window.start;
  const start = clamp(window.start + deltaRatio, 0, 1 - span);
  return { start, end: start + span };
}

/** 把可见时间区间换算成数据下标区间，供覆盖层只统计屏幕上看得到的点。 */
export function zoomWindowIndexRange(
  times: ReadonlyArray<number>,
  range: ChartRange,
): { fromIndex: number; toIndex: number } {
  if (times.length === 0) return { fromIndex: 0, toIndex: -1 };
  let fromIndex = times.length;
  let toIndex = -1;
  for (let index = 0; index < times.length; index += 1) {
    const time = times[index];
    if (time < range[0] || time > range[1]) continue;
    if (index < fromIndex) fromIndex = index;
    toIndex = index;
  }
  return toIndex < 0 ? { fromIndex: 0, toIndex: -1 } : { fromIndex, toIndex };
}
