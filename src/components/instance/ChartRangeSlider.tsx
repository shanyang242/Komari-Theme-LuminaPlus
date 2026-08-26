import {
  useCallback,
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  clampZoomWindow,
  isFullZoomWindow,
  panZoomWindow,
  type ChartZoomWindow,
} from "./chartZoom";

export interface ChartRangePreviewSeries {
  values: ReadonlyArray<number | null | undefined>;
  color: string;
}

// 键盘微调步长：与 chartZoom 的最小窗口同量级，按一下就有肉眼可见的位移。
const KEYBOARD_STEP = 0.02;
const PREVIEW_LINE_ALPHA = 0.55;

type DragState =
  | { kind: "start" }
  | { kind: "end" }
  | { kind: "pan"; grabOffset: number };

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function toPercent(ratio: number) {
  return `${(clamp(ratio, 0, 1) * 100).toFixed(4)}%`;
}

function drawPreview(
  canvas: HTMLCanvasElement,
  series: readonly ChartRangePreviewSeries[],
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (width <= 0 || height <= 0) return;

  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let length = 0;
  for (const item of series) {
    length = Math.max(length, item.values.length);
    for (const value of item.values) {
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      if (value < min) min = value;
      if (value > max) max = value;
    }
  }
  if (length < 2 || min === Number.POSITIVE_INFINITY) return;

  const span = max - min || 1;
  const padding = 2;
  const usableHeight = Math.max(1, height - padding * 2);
  ctx.lineWidth = 1;
  ctx.globalAlpha = PREVIEW_LINE_ALPHA;

  for (const item of series) {
    ctx.strokeStyle = item.color;
    ctx.beginPath();
    let pendingMove = true;
    for (let index = 0; index < item.values.length; index += 1) {
      const value = item.values[index];
      if (typeof value !== "number" || !Number.isFinite(value)) {
        // null(丢包/中断) 断开缩略线；undefined(off-phase) 同样跳过，缩略图不需要区分两者。
        pendingMove = true;
        continue;
      }
      const x = (index / (length - 1)) * width;
      const y = padding + usableHeight * (1 - (value - min) / span);
      if (pendingMove) {
        ctx.moveTo(x, y);
        pendingMove = false;
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
  }
}

/**
 * 主图下方的横向缩放条，对标哪吒面板服务监控图的 dataZoom：
 * 背景是整段数据的缩略曲线，左右把手改区间、中间色块拖动平移、双击恢复全量。
 * 窗口比例是唯一数据源，主图的 x scale 由它单向驱动。
 */
export function ChartRangeSlider({
  window: zoomWindow,
  series,
  onChange,
  onReset,
}: {
  window: ChartZoomWindow;
  series: readonly ChartRangePreviewSeries[];
  onChange: (next: ChartZoomWindow) => void;
  onReset: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<DragState | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const render = () => drawPreview(canvas, series);
    render();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(render);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [series]);

  const ratioFromClientX = useCallback((clientX: number) => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return null;
    return clamp((clientX - rect.left) / rect.width, 0, 1);
  }, []);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const role = (event.target as HTMLElement).dataset.dragRole;
      if (!role) return;
      const ratio = ratioFromClientX(event.clientX);
      if (ratio == null) return;
      event.preventDefault();
      rootRef.current?.setPointerCapture(event.pointerId);
      dragRef.current =
        role === "pan"
          ? { kind: "pan", grabOffset: ratio - zoomWindow.start }
          : role === "start"
            ? { kind: "start" }
            : { kind: "end" };
    },
    [ratioFromClientX, zoomWindow.start],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      const ratio = ratioFromClientX(event.clientX);
      if (ratio == null) return;
      if (drag.kind === "pan") {
        onChange(panZoomWindow(zoomWindow, ratio - drag.grabOffset - zoomWindow.start));
        return;
      }
      onChange(
        clampZoomWindow(
          drag.kind === "start"
            ? { start: ratio, end: zoomWindow.end }
            : { start: zoomWindow.start, end: ratio },
        ),
      );
    },
    [onChange, ratioFromClientX, zoomWindow],
  );

  const endDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    if (rootRef.current?.hasPointerCapture(event.pointerId)) {
      rootRef.current.releasePointerCapture(event.pointerId);
    }
  }, []);

  const nudge = useCallback(
    (edge: "start" | "end", delta: number) => {
      onChange(
        clampZoomWindow(
          edge === "start"
            ? { start: zoomWindow.start + delta, end: zoomWindow.end }
            : { start: zoomWindow.start, end: zoomWindow.end + delta },
        ),
      );
    },
    [onChange, zoomWindow],
  );

  const handleKeyDown = (edge: "start" | "end") => (event: ReactKeyboardEvent) => {
    if (event.key === "ArrowLeft") nudge(edge, -KEYBOARD_STEP);
    else if (event.key === "ArrowRight") nudge(edge, KEYBOARD_STEP);
    else if (event.key === "Home") nudge(edge, -1);
    else if (event.key === "End") nudge(edge, 1);
    else return;
    event.preventDefault();
  };

  const windowWidth = Math.max(0, zoomWindow.end - zoomWindow.start);

  return (
    <div className="instance-range-slider">
      <div
        ref={rootRef}
        className="instance-range-slider-track"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={onReset}
      >
        <canvas ref={canvasRef} className="instance-range-slider-canvas" aria-hidden />
        <div
          className="instance-range-slider-window"
          data-drag-role="pan"
          style={{ left: toPercent(zoomWindow.start), width: toPercent(windowWidth) }}
        >
          <button
            type="button"
            className="instance-range-slider-handle is-start"
            data-drag-role="start"
            role="slider"
            aria-label="缩放起点"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(zoomWindow.start * 100)}
            aria-valuetext={`起点 ${Math.round(zoomWindow.start * 100)}%`}
            onKeyDown={handleKeyDown("start")}
          />
          <button
            type="button"
            className="instance-range-slider-handle is-end"
            data-drag-role="end"
            role="slider"
            aria-label="缩放终点"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(zoomWindow.end * 100)}
            aria-valuetext={`终点 ${Math.round(zoomWindow.end * 100)}%`}
            onKeyDown={handleKeyDown("end")}
          />
        </div>
      </div>
      <button
        type="button"
        className="instance-toggle-button instance-range-slider-reset"
        onClick={onReset}
        disabled={isFullZoomWindow(zoomWindow)}
      >
        恢复全部
      </button>
    </div>
  );
}
