import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type uPlot from "uplot";

// 共享的图表配色。LoadChart 按指标 (cpu/memory/…) 取色，PingChart 按 task 循环取色；
// 两者都取自这一处单一来源，避免 hex 值在两个图表间漂移。
export const CHART_PALETTE = {
  cpu: "#5d88ff",
  memory: "#a35cf5",
  disk: "#f1873d",
  success: "#61c08f",
  warning: "#d4a54a",
} as const;

// 备用定性色板（仅缺少总数时用）；正常走下面的 OKLCH 生成。
const CHART_SERIES_COLORS = [
  "#4878d0", // 蓝
  "#ee854a", // 橙
  "#6acc64", // 绿
  "#d65f5f", // 红
  "#956cb4", // 紫
  "#8c613c", // 棕
  "#dc7ec0", // 粉
  "#4aa7a0", // 青
  "#c7b446", // 芥黄
  "#82c6e2", // 浅蓝
] as const;

let oklchSupported: boolean | null = null;
function supportsOklch(): boolean {
  if (oklchSupported === null) {
    oklchSupported =
      typeof window !== "undefined" &&
      typeof window.CSS !== "undefined" &&
      typeof window.CSS.supports === "function" &&
      window.CSS.supports("color", "oklch(0.7 0.2 120 / 0.85)");
  }
  return oklchSupported;
}

export function colorForSeries(index: number, total?: number): string {
  // 没有总数时（防御性调用）退回精选板。
  if (typeof total !== "number" || total <= 0) {
    return CHART_SERIES_COLORS[index % CHART_SERIES_COLORS.length];
  }
  // 色相按总数均分，用 OKLCH 渲染：固定明度让每条线一样亮、中等彩度不刺眼、0.85 透明度让密集区
  // 混色不互相盖死；不支持则降级 HSL。
  const hue = Math.round((index * 360) / total);
  return supportsOklch()
    ? `oklch(0.7 0.2 ${hue} / 0.95)`
    : `hsl(${hue}, 50%, 60%)`;
}

// uPlot 图表的坐标轴网格/文字颜色。单一来源，避免 LoadChart 和 PingChart 在 dark/light 字面量上漂移。
export function getAxisColors(isDark: boolean): { grid: string; text: string } {
  return {
    grid: isDark ? "rgba(255,255,255,0.065)" : "rgba(0,0,0,0.08)",
    text: isDark ? "#a5a5aa" : "#52525b",
  };
}

// uPlot 图表 (LoadChart / PingChart) 共享的悬停 tooltip 状态结构。
export interface ChartTooltipState {
  show: boolean;
  left: number;
  top: number;
  rows: Array<{ label: string; value: string; color: string }>;
  time: string;
}

interface TimeRangeOption {
  label: string;
  value: number;
}

// load 和 ping 共用同一套历史区间预设；唯一区别是是否在前面加 "实时" 选项，这由
// buildHistoryRangeOptions 的 includeRealtime 标志处理，而非改预设列表本身。
const TIME_RANGE_OPTIONS: TimeRangeOption[] = [
  { label: "1 小时", value: 1 },
  { label: "4 小时", value: 4 },
  { label: "1 天", value: 24 },
  { label: "7 天", value: 168 },
  { label: "30 天", value: 720 },
];

function formatRangeLabel(hours: number) {
  if (hours % 24 === 0) {
    const days = hours / 24;
    return `${days} 天`;
  }

  return `${hours} 小时`;
}

function buildHistoryRangeOptions(
  presets: TimeRangeOption[],
  maxHours: number | null | undefined,
  includeRealtime: boolean,
) {
  const options = includeRealtime ? [{ label: "实时", value: 0 }] : [];
  if (!Number.isFinite(maxHours) || !maxHours || maxHours <= 0) {
    return [...options, ...presets];
  }

  const safeMaxHours = Math.floor(maxHours);
  const resolved = presets.filter((option) => option.value <= safeMaxHours);
  const hasExactMatch = resolved.some((option) => option.value === safeMaxHours);

  if (safeMaxHours > 0 && !hasExactMatch) {
    resolved.push({
      label: formatRangeLabel(safeMaxHours),
      value: safeMaxHours,
    });
  }

  return [...options, ...resolved];
}

export function buildLoadTimeRangeOptions(maxHours: number | null | undefined) {
  return buildHistoryRangeOptions(TIME_RANGE_OPTIONS, maxHours, true);
}

export function buildPingTimeRangeOptions(maxHours: number | null | undefined) {
  return buildHistoryRangeOptions(TIME_RANGE_OPTIONS, maxHours, false);
}

const GRID_CHART_DEFAULT = { w: 420, h: 150 };
const GRID_CHART_DESKTOP_MAX_WIDTH = 480;
const GRID_CHART_TABLET_MAX_WIDTH = 560;
const GRID_CHART_DESKTOP_GUTTER = 180;
const GRID_CHART_TABLET_GUTTER = 100;
const GRID_CHART_MOBILE_GUTTER = 56;
const GRID_CHART_HEIGHT = 132;
const WIDE_CHART_MIN_WIDTH = 300;
const WIDE_CHART_MAX_WIDTH = 1720;
const WIDE_CHART_GUTTER = 96;
const WIDE_CHART_HEIGHT = 340;
const WIDE_CHART_TABLET_HEIGHT = 300;
const WIDE_CHART_MOBILE_HEIGHT = 260;
// 把响应式图表宽度量化到这个步长，让拖拽改尺寸收敛到离散尺寸，而非每个像素都重建 uPlot。
const CHART_WIDTH_STEP = 8;

export function toChartSeconds(value: string | number): number {
  if (typeof value === "number") {
    return value > 1_000_000_000_000 ? value / 1000 : value;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed / 1000;
}

function pad2(value: number) {
  return value.toString().padStart(2, "0");
}

function getDateParts(timestampSeconds: number) {
  const date = new Date(timestampSeconds * 1000);
  return {
    year: date.getFullYear(),
    month: pad2(date.getMonth() + 1),
    day: pad2(date.getDate()),
    hour: pad2(date.getHours()),
    minute: pad2(date.getMinutes()),
    second: pad2(date.getSeconds()),
  };
}

function formatAxisTime(timestampSeconds: number, rangeHours: number) {
  const parts = getDateParts(timestampSeconds);
  if (rangeHours >= 72) return `${parts.month}/${parts.day}`;
  return `${parts.hour}:${parts.minute}`;
}

export function createTimeAxisFormatter(rangeHours: number) {
  return (_self: uPlot, splits: number[]): string[] =>
    splits.map((value) => formatAxisTime(value, rangeHours));
}

function formatTooltipTime(timestampSeconds: number, rangeHours = 0): string {
  const parts = getDateParts(timestampSeconds);
  if (rangeHours >= 24) {
    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
  }
  return `${parts.hour}:${parts.minute}:${parts.second}`;
}

export function formatChartCoverageTime(timestampSeconds: number): string {
  const parts = getDateParts(timestampSeconds);
  return `${parts.month}/${parts.day} ${parts.hour}:${parts.minute}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getChartTooltipPosition({
  containerWidth,
  containerHeight,
  anchorX,
  anchorY,
  rowCount,
  estimatedWidth = 188,
}: {
  containerWidth: number;
  containerHeight: number;
  anchorX: number;
  anchorY: number;
  rowCount: number;
  estimatedWidth?: number;
}) {
  const margin = 10;
  const offsetX = 18;
  const offsetY = 16;
  const estimatedHeight = 34 + rowCount * 22;
  const maxLeft = Math.max(margin, containerWidth - estimatedWidth - margin);
  const maxTop = Math.max(margin, containerHeight - estimatedHeight - margin);

  let left =
    anchorX + estimatedWidth + offsetX <= containerWidth - margin
      ? anchorX + offsetX
      : anchorX - estimatedWidth - offsetX;
  left = clamp(left, margin, maxLeft);

  let top = anchorY - estimatedHeight - offsetY;
  if (top < margin) top = anchorY + offsetY;
  top = clamp(top, margin, maxTop);

  return { left, top };
}

// LoadChart 和 PingChart 共享的光标/tooltip 流程。两者接的是同一套 uPlot hook——mouseleave 时隐藏，
// 光标移动时读取悬停的 x 时间戳，用 getChartTooltipPosition 定位并提交 tooltip——所以只有每行的
// 格式化 (buildRows) 和 tooltip 预估宽度不同。`dataRef` 指向实时的 AlignedData (chart 把自己的数据
// 存在 ref 里，免得 hook 闭包拿到过期数据)。
export function buildChartTooltipHooks({
  dataRef,
  rangeHours,
  estimatedWidth,
  setTooltip,
  buildRows,
}: {
  dataRef: { readonly current: uPlot.AlignedData };
  rangeHours: number;
  estimatedWidth: number;
  setTooltip: Dispatch<SetStateAction<ChartTooltipState>>;
  buildRows: (idx: number) => ChartTooltipState["rows"];
}): { onInit: (u: uPlot) => void; onSetCursor: (u: uPlot) => void } {
  const hide = () => setTooltip((prev) => ({ ...prev, show: false }));
  return {
    onInit: (u) => {
      u.root.addEventListener("mouseleave", hide);
    },
    onSetCursor: (u) => {
      const idx = u.cursor.idx;
      if (idx == null || idx < 0) {
        hide();
        return;
      }
      const timestamp = dataRef.current[0]?.[idx];
      if (typeof timestamp !== "number") {
        hide();
        return;
      }
      const bbox = u.root.getBoundingClientRect();
      const anchorX = u.valToPos(timestamp, "x");
      const anchorY = typeof u.cursor.top === "number" ? u.cursor.top : bbox.height * 0.5;
      const rows = buildRows(idx);
      const position = getChartTooltipPosition({
        containerWidth: bbox.width,
        containerHeight: bbox.height,
        anchorX,
        anchorY,
        rowCount: rows.length,
        estimatedWidth,
      });
      setTooltip({
        show: true,
        left: position.left,
        top: position.top,
        rows,
        time: formatTooltipTime(timestamp, rangeHours),
      });
    },
  };
}

function computeChartSize(
  mode: "grid" | "wide",
  viewportWidth: number,
  containerWidth?: number,
): { w: number; h: number } {
  // 在封顶以下，grid 宽度是连续的 (width - gutter) / N，所以拖拽改尺寸时精确的"不变则跳过"
  // 永远不触发，每个 rAF 帧都会重建全部 6 个 uPlot 图表。量化到步长能把一串近乎相同的宽度
  // 收敛成一个，于是大约每步才重建一次。
  const q = (value: number) => Math.floor(value / CHART_WIDTH_STEP) * CHART_WIDTH_STEP;

  if (mode === "wide") {
    const height =
      viewportWidth < 720
        ? WIDE_CHART_MOBILE_HEIGHT
        : viewportWidth < 1024
          ? WIDE_CHART_TABLET_HEIGHT
          : WIDE_CHART_HEIGHT;
    const measuredWidth =
      typeof containerWidth === "number" && containerWidth > 0
        ? containerWidth
        : viewportWidth - WIDE_CHART_GUTTER;
    return {
      w: Math.min(WIDE_CHART_MAX_WIDTH, Math.max(WIDE_CHART_MIN_WIDTH, q(measuredWidth))),
      h: height,
    };
  }

  if (viewportWidth >= 1280) {
    return {
      w: Math.min(GRID_CHART_DESKTOP_MAX_WIDTH, q((viewportWidth - GRID_CHART_DESKTOP_GUTTER) / 3)),
      h: GRID_CHART_HEIGHT,
    };
  }

  if (viewportWidth >= 768) {
    return {
      w: Math.min(GRID_CHART_TABLET_MAX_WIDTH, q((viewportWidth - GRID_CHART_TABLET_GUTTER) / 2)),
      h: GRID_CHART_HEIGHT,
    };
  }

  return {
    w: Math.max(WIDE_CHART_MIN_WIDTH - 20, q(viewportWidth - GRID_CHART_MOBILE_GUTTER)),
    h: 136,
  };
}

export function useResponsiveChartSize(mode: "grid" | "wide") {
  const [size, setSize] = useState(
    mode === "grid"
      ? GRID_CHART_DEFAULT
      : { w: WIDE_CHART_MAX_WIDTH, h: WIDE_CHART_HEIGHT },
  );
  const nodeRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);

  const apply = useCallback(() => {
    const next = computeChartSize(mode, window.innerWidth, nodeRef.current?.clientWidth);
    // 计算出的尺寸没变就跳过 setState (以及它触发的 uPlot 拆建)。
    setSize((prev) => (prev.w === next.w && prev.h === next.h ? prev : next));
  }, [mode]);

  const scheduleApply = useCallback(() => {
    if (frameRef.current != null) return;
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      apply();
    });
  }, [apply]);

  // 回调 ref：容器每次重新挂载都重新测量 + 重新 observe（修复卸载后 observer 失效、尺寸冻结）。
  const ref = useCallback(
    (node: HTMLDivElement | null) => {
      observerRef.current?.disconnect();
      observerRef.current = null;
      nodeRef.current = node;
      if (node) {
        if (mode === "wide" && typeof ResizeObserver !== "undefined") {
          const observer = new ResizeObserver(scheduleApply);
          observer.observe(node);
          observerRef.current = observer;
        }
        scheduleApply();
      }
    },
    [mode, scheduleApply],
  );

  useEffect(() => {
    apply();
    window.addEventListener("resize", scheduleApply);
    return () => {
      window.removeEventListener("resize", scheduleApply);
      observerRef.current?.disconnect();
      if (frameRef.current != null) window.cancelAnimationFrame(frameRef.current);
    };
  }, [apply, scheduleApply]);

  return { ...size, ref };
}
