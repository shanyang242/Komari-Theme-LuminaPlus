import { useCallback, type ReactNode } from "react";
import { CanvasStrip, fillRoundedRect, safeCanvasColor } from "./CanvasStrip";

const METRIC_SEGMENT_COUNT = 18;

type MetricPaint =
  | {
      kind: "solid";
      color: string;
    }
  | {
      kind: "gradient";
      from: string;
      to: string;
    };

interface MetricBarProps {
  icon: ReactNode;
  label: string;
  valueText: string;
  unit?: string;
  detailText?: string;
  fraction: number; // 0..1
  redrawKey?: string;
  paint: MetricPaint;
}

export function MetricBar({
  icon,
  label,
  valueText,
  unit,
  detailText,
  fraction,
  redrawKey,
  paint,
}: MetricBarProps) {
  const clamped = Math.max(0, Math.min(1, fraction));
  const activeSegments = clamped * METRIC_SEGMENT_COUNT;
  const paintKind = paint.kind;
  const paintColor = paint.kind === "solid" ? paint.color : "";
  const paintFrom = paint.kind === "gradient" ? paint.from : "";
  const paintTo = paint.kind === "gradient" ? paint.to : "";

  // Stable across renders unless the fill level or paint actually changes, so
  // the CanvasStrip redraw effect doesn't fire on every parent metrics tick.
  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, width: number, height: number) => {
      const inactiveColor = safeCanvasColor("var(--progress-bg)");
      const gap = 2;
      const segmentWidth = Math.max(
        1,
        (width - gap * (METRIC_SEGMENT_COUNT - 1)) / METRIC_SEGMENT_COUNT,
      );
      const activePaint =
        paintKind === "gradient"
          ? (() => {
              const gradient = ctx.createLinearGradient(0, 0, width, 0);
              gradient.addColorStop(0, safeCanvasColor(paintFrom));
              gradient.addColorStop(1, safeCanvasColor(paintTo));
              return gradient;
            })()
          : safeCanvasColor(paintColor);

      for (let index = 0; index < METRIC_SEGMENT_COUNT; index += 1) {
        const x = index * (segmentWidth + gap);
        const fillLevel = Math.max(0, Math.min(1, activeSegments - index));
        const isActive = fillLevel > 0;

        ctx.globalAlpha = 0.58;
        ctx.fillStyle = inactiveColor;
        fillRoundedRect(ctx, x, 0, segmentWidth, height, 2);

        if (isActive) {
          ctx.globalAlpha = 0.42 + fillLevel * 0.56;
          ctx.fillStyle = activePaint;
          fillRoundedRect(ctx, x, 0, segmentWidth, height, 2);
        }
      }

      ctx.globalAlpha = 1;
    },
    [activeSegments, paintKind, paintColor, paintFrom, paintTo],
  );

  return (
    <div className="metric-item">
      <div className="flex justify-between items-center gap-3 min-w-0">
        <div className="flex items-center gap-1.5 text-[var(--text-secondary)] flex-shrink-0">
          <span>{icon}</span>
          <span className="text-[11px] font-medium tracking-[0.02em]">{label}</span>
        </div>
        <div className="tabular text-[13px] text-[var(--text-primary)] whitespace-nowrap overflow-hidden text-ellipsis max-w-full text-right">
          <span className="font-semibold">{valueText}</span>
          {unit && (
            <span className="ml-[1px] text-[11px] text-[var(--text-tertiary)]">{unit}</span>
          )}
        </div>
      </div>
      <div
        className="metric-detail"
        title={detailText}
        data-empty={detailText ? "false" : "true"}
      >
        {detailText ?? "\u00A0"}
      </div>
      <div className="metric-track">
        <CanvasStrip
          className="metric-track-canvas"
          height={10}
          ariaHidden
          redrawKey={redrawKey}
          draw={draw}
        />
      </div>
    </div>
  );
}
