import { useCallback, useMemo } from "react";
import { CanvasStrip, fillRoundedRect, safeCanvasColor } from "./CanvasStrip";
import {
  getBarGeometry,
  getBarSlot,
  healthBarInteractionModel,
  healthBarSlotModel,
} from "./nodeCardShared";
import type { PingOverviewBucket } from "@/types/komari";

interface HealthBarsProps {
  kind: "latency" | "loss";
  buckets: PingOverviewBucket[];
  redrawKey?: string;
  height?: number;
  onHoverIndex?: (index: number | null) => void;
}

export function HealthBars({
  kind,
  buckets,
  redrawKey,
  height = 16,
  onHoverIndex,
}: HealthBarsProps) {
  const bars = useMemo(
    () => {
      // 随 redrawKey 重新解析 CSS 色值
      void redrawKey;
      return buckets.map((bucket) => {
        const slot = healthBarSlotModel(bucket, kind);
        return { ...slot, tone: safeCanvasColor(slot.color) };
      });
    },
    [buckets, kind, redrawKey],
  );

  const getHoverIndex = useCallback(
    (offsetX: number, width: number) => getBarSlot(offsetX, width, bars.length),
    [bars.length],
  );

  const draw = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      width: number,
      canvasHeight: number,
      interaction: { hoverIndex: number | null; hoverProgress: number },
    ) => {
      const { gap, barWidth } = getBarGeometry(width, bars.length);

      bars.forEach(({ heightFraction, alpha, tone }, index) => {
        const visual = healthBarInteractionModel(
          { active: true, heightFraction, color: tone, alpha },
          interaction.hoverIndex === index,
          interaction.hoverProgress,
        );
        const barHeight = canvasHeight * visual.heightFraction;
        const x = index * (barWidth + gap);
        const y = canvasHeight - barHeight;

        ctx.globalAlpha = visual.alpha;
        ctx.fillStyle = tone;
        fillRoundedRect(ctx, x, y, barWidth, barHeight, 2);
      });

      ctx.globalAlpha = 1;
    },
    [bars],
  );

  return (
    <CanvasStrip
      className="health-bar-row"
      height={height}
      redrawKey={redrawKey}
      getHoverIndex={getHoverIndex}
      onHoverIndex={onHoverIndex}
      draw={draw}
    />
  );
}
