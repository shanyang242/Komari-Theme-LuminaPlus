import { useCallback, useMemo } from "react";
import { CanvasStrip, fillRoundedRect, safeCanvasColor } from "./CanvasStrip";
import { getBarGeometry, getBarSlot } from "./nodeCardShared";
import { latencyHeatColor } from "@/utils/metricTone";
import type { PingOverviewBucket } from "@/types/komari";

interface MiniBarsProps {
  /** 聚合后的延迟分桶(始终是定长窗口)。 */
  buckets: PingOverviewBucket[];
  /** 归一化到 0..1 的分母(窗口内的最大延迟)。 */
  max: number;
  redrawKey?: string;
  onHoverIndex?: (index: number | null) => void;
}

/** 由聚合 ping 分桶驱动、像素对齐的延迟柱状图。 */
export function MiniBars({ buckets, max, redrawKey, onHoverIndex }: MiniBarsProps) {
  const bars = useMemo(
    () =>
      buckets.map((bucket) => ({
        value: bucket.value ?? 0,
        // value 非 null(含 0=亚毫秒成功)即有有效延迟;null 表示无样本或全丢包,画成空槽。
        has: bucket.value != null,
        index: bucket.index,
        // 在这里(按桶、数据变化时)归一化成 canvas 安全色,而不是每次重绘对每根柱子算。
        tone: safeCanvasColor(latencyHeatColor(bucket.value)),
      })),
    [buckets],
  );

  const getHoverIndex = useCallback(
    (offsetX: number, width: number) => {
      const slot = getBarSlot(offsetX, width, bars.length);
      return slot == null ? null : bars[slot]?.index ?? null;
    },
    [bars],
  );

  // 除非分桶数据(bars)或刻度(max)变化,否则保持稳定,这样 canvas 不会在父组件
  // 每个 metrics tick 都重绘——只在 ping 刷新时重绘。
  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, width: number, height: number) => {
      const inactiveColor = safeCanvasColor("var(--progress-bg)");
      const { gap, barWidth } = getBarGeometry(width, bars.length);
      const safeMax = max > 0 ? max : 1;

      bars.forEach(({ value, has, tone }, index) => {
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
