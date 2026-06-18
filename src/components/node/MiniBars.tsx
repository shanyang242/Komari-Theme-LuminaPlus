import { useCallback, useMemo } from "react";
import { CanvasStrip, fillRoundedRect, safeCanvasColor } from "./CanvasStrip";
import { latencyHeatColor } from "@/utils/metricTone";
import type { PingOverviewBucket } from "@/types/komari";

interface MiniBarsProps {
  /** Aggregated latency buckets (always a fixed-length window). */
  buckets: PingOverviewBucket[];
  /** Denominator for 0..1 normalization (max latency across the window). */
  max: number;
  redrawKey?: string;
  onHoverIndex?: (index: number | null) => void;
}

/** Pixel-matched latency histogram driven by aggregated ping buckets. */
export function MiniBars({ buckets, max, redrawKey, onHoverIndex }: MiniBarsProps) {
  const bars = useMemo(
    () =>
      buckets.map((bucket) => ({
        value: bucket.value ?? 0,
        index: bucket.index,
        // Normalize to a canvas-safe color here (per bucket, on data change) rather
        // than per bar on every redraw.
        tone: safeCanvasColor(latencyHeatColor(bucket.value)),
      })),
    [buckets],
  );

  const getHoverIndex = useCallback(
    (offsetX: number, width: number) => {
      if (bars.length === 0 || width <= 0) return null;
      const slotWidth = width / bars.length;
      const slot = Math.max(0, Math.min(bars.length - 1, Math.floor(offsetX / slotWidth)));
      return bars[slot]?.index ?? null;
    },
    [bars],
  );

  // Stable unless the bucket data (bars) or scale (max) changes, so the canvas
  // doesn't redraw on every parent metrics tick — only on ping refreshes.
  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, width: number, height: number) => {
      const inactiveColor = safeCanvasColor("var(--progress-bg)");
      const gap = bars.length > 48 ? 1 : 2;
      const barWidth = Math.max(1, (width - gap * (bars.length - 1)) / Math.max(1, bars.length));
      const safeMax = max > 0 ? max : 1;

      bars.forEach(({ value, tone }, index) => {
        const has = value > 0;
        const barHeight = height * (has ? Math.max(0.2, Math.min(1, value / safeMax)) : 0.25);
        const x = index * (barWidth + gap);
        const y = height - barHeight;

        ctx.globalAlpha = has ? 0.92 : 0.55;
        ctx.fillStyle = has ? tone : inactiveColor;
        fillRoundedRect(ctx, x, y, barWidth, barHeight, 2);
      });

      ctx.globalAlpha = 1;
    },
    [bars, max],
  );

  return (
    <CanvasStrip
      className="mini-bar-row"
      height={16}
      ariaHidden
      redrawKey={redrawKey}
      getHoverIndex={getHoverIndex}
      onHoverIndex={onHoverIndex}
      draw={draw}
    />
  );
}
