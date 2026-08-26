import type uPlot from "uplot";

// PingChart 的 uPlot 覆盖层：丢包竖线 + 极值 pin。
// 对齐数据里 null = 真实断点(丢包/中断)、undefined = off-phase 无采样，两者语义不同，
// 只有 null 才是「这一刻探测失败」，才值得在图上立一条竖线。

export type ChartSeriesValues = ReadonlyArray<number | null | undefined>;

export interface PingExtremePoint {
  index: number;
  value: number;
}

export interface PingSeriesOverlay {
  color: string;
  lossIndices: number[];
  max: PingExtremePoint | null;
  min: PingExtremePoint | null;
}

export interface PingOverlayRange {
  fromIndex: number;
  toIndex: number;
}

// 丢包比例超过这个值就不画竖线：整段几乎全丢时逐点画会把绘图区涂成实色，
// 反而什么都读不出来。哪吒面板的服务监控图同款处理(lossRate > 99 时清空 markLine)。
const LOSS_MARK_SUPPRESS_RATIO = 0.99;
// 样本太少时不启用上面的抑制，否则「唯一一次采样正好丢包」会被判成全丢而不画。
const LOSS_MARK_SUPPRESS_MIN_SAMPLES = 10;

export function buildPingSeriesOverlay(
  values: ChartSeriesValues,
  color: string,
  range?: PingOverlayRange,
): PingSeriesOverlay {
  const fromIndex = Math.max(0, range?.fromIndex ?? 0);
  const toIndex = Math.min(values.length - 1, range?.toIndex ?? values.length - 1);
  const lossIndices: number[] = [];
  let max: PingExtremePoint | null = null;
  let min: PingExtremePoint | null = null;
  let validCount = 0;

  for (let index = fromIndex; index <= toIndex; index += 1) {
    const value = values[index];
    if (value === null) {
      lossIndices.push(index);
      continue;
    }
    // 0 是亚毫秒成功探测，负值不该出现在图数据里(上游已转成 null)，一并当作无效跳过。
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) continue;
    validCount += 1;
    if (max == null || value > max.value) max = { index, value };
    if (min == null || value < min.value) min = { index, value };
  }

  const sampled = validCount + lossIndices.length;
  const suppressLossMarks =
    sampled >= LOSS_MARK_SUPPRESS_MIN_SAMPLES &&
    lossIndices.length / sampled > LOSS_MARK_SUPPRESS_RATIO;

  return {
    color,
    lossIndices: suppressLossMarks ? [] : lossIndices,
    max,
    // 极值相等时只保留 max，避免两个 pin 完全重叠在同一点上。
    min: min != null && max != null && min.index === max.index ? null : min,
  };
}

const LOSS_LINE_ALPHA = 0.42;
const LOSS_LINE_WIDTH = 1;
const PIN_RADIUS = 9;
const PIN_TIP = 7;
const PIN_FILL_ALPHA = 0.55;
const PIN_FONT_SIZE = 8;

function pinPath(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  radius: number,
  tipLength: number,
  pointingDown: boolean,
) {
  const direction = pointingDown ? 1 : -1;
  // 圆心到切点的夹角：让三角形两边正好贴着圆周，画出水滴形而不是「圆上挂个三角」。
  const spread = Math.PI / 3;
  const base = pointingDown ? Math.PI / 2 : -Math.PI / 2;
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, base + spread, base - spread + Math.PI * 2);
  ctx.lineTo(centerX, centerY + direction * (radius + tipLength));
  ctx.closePath();
}

function drawPin(
  ctx: CanvasRenderingContext2D,
  point: { x: number; y: number },
  value: number,
  color: string,
  ratio: number,
  bbox: uPlot.BBox,
  preferAbove: boolean,
) {
  const radius = PIN_RADIUS * ratio;
  const tipLength = PIN_TIP * ratio;
  const offset = radius + tipLength;
  // 贴着绘图区边缘时把 pin 翻到点的另一侧，避免被裁掉只剩半个气泡。
  const fitsAbove = point.y - offset - radius >= bbox.top;
  const fitsBelow = point.y + offset + radius <= bbox.top + bbox.height;
  const above = preferAbove ? fitsAbove || !fitsBelow : fitsAbove && !fitsBelow;
  const centerY = above ? point.y - offset : point.y + offset;

  ctx.save();
  ctx.globalAlpha = PIN_FILL_ALPHA;
  ctx.fillStyle = color;
  pinPath(ctx, point.x, centerY, radius, tipLength, above);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.font = `600 ${PIN_FONT_SIZE * ratio}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(Math.round(value)), point.x, centerY);
  ctx.restore();
}

/** 在 uPlot 的 draw hook 中调用：先画丢包竖线垫底，再画极值 pin 压在最上层。 */
export function drawPingOverlay(
  u: uPlot,
  overlays: readonly PingSeriesOverlay[],
  options: { showLossLines: boolean; showExtremePins: boolean },
) {
  if (overlays.length === 0) return;
  if (!options.showLossLines && !options.showExtremePins) return;

  const ctx = u.ctx;
  const times = u.data[0];
  const ratio = u.bbox.width / Math.max(1, u.over.clientWidth);

  ctx.save();
  ctx.beginPath();
  ctx.rect(u.bbox.left, u.bbox.top, u.bbox.width, u.bbox.height);
  ctx.clip();

  if (options.showLossLines) {
    ctx.lineWidth = LOSS_LINE_WIDTH * ratio;
    for (const overlay of overlays) {
      ctx.save();
      ctx.globalAlpha = LOSS_LINE_ALPHA;
      ctx.strokeStyle = overlay.color;
      ctx.beginPath();
      for (const index of overlay.lossIndices) {
        const time = times[index];
        if (typeof time !== "number") continue;
        const x = Math.round(u.valToPos(time, "x", true)) + 0.5;
        ctx.moveTo(x, u.bbox.top);
        ctx.lineTo(x, u.bbox.top + u.bbox.height);
      }
      ctx.stroke();
      ctx.restore();
    }
  }

  if (options.showExtremePins) {
    for (const overlay of overlays) {
      for (const extreme of [overlay.max, overlay.min]) {
        if (!extreme) continue;
        const time = times[extreme.index];
        if (typeof time !== "number") continue;
        drawPin(
          ctx,
          {
            x: u.valToPos(time, "x", true),
            y: u.valToPos(extreme.value, "y", true),
          },
          extreme.value,
          overlay.color,
          ratio,
          u.bbox,
          extreme === overlay.max,
        );
      }
    }
  }

  ctx.restore();
}
