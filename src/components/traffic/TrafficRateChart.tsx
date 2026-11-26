import { useMemo, useRef, useState } from "react";
import UplotReact from "uplot-react";
import type uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { ChartTooltip } from "@/components/instance/ChartParts";
import {
  buildChartTooltipHooks,
  CHART_PALETTE,
  createTimeAxisFormatter,
  getAxisColors,
  useResponsiveChartSize,
  type ChartTooltipState,
} from "@/components/instance/chartShared";
import { usePreferences } from "@/hooks/usePreferences";
import { formatByteRateLabel } from "@/utils/format";
import type { TodayTrafficSample } from "@/utils/trafficStats";

const UP_COLOR = CHART_PALETTE.cpu;
const DOWN_COLOR = CHART_PALETTE.success;

function axisRate(value: number) {
  return Number.isFinite(value) && value > 0 ? formatByteRateLabel(value) : "";
}

export function TrafficRateChart({ samples }: { samples: TodayTrafficSample[] }) {
  const { resolvedAppearance } = usePreferences();
  const { w, ref: chartSizeRef } = useResponsiveChartSize("grid");
  const height = w < 560 ? 182 : 220;
  const data = useMemo<uPlot.AlignedData>(() => {
    const count = samples.length;
    if (count === 0) return [[], [], []] as uPlot.AlignedData;

    // 常规路径 samples 已按时间降序（或升序）排列，O(N) 线性生成避免 O(N log N) 重复排序。
    let isAsc = true;
    let isDesc = true;
    for (let index = 1; index < count; index += 1) {
      const prev = samples[index - 1].timeMs;
      const curr = samples[index].timeMs;
      if (curr < prev) isAsc = false;
      if (curr > prev) isDesc = false;
      if (!isAsc && !isDesc) break;
    }

    const times = new Array<number>(count);
    const up = new Array<number>(count);
    const down = new Array<number>(count);
    if (isAsc) {
      for (let index = 0; index < count; index += 1) {
        const sample = samples[index];
        times[index] = sample.timeMs / 1000;
        up[index] = sample.up;
        down[index] = sample.down;
      }
    } else if (isDesc) {
      for (let index = 0; index < count; index += 1) {
        const sample = samples[count - 1 - index];
        times[index] = sample.timeMs / 1000;
        up[index] = sample.up;
        down[index] = sample.down;
      }
    } else {
      const ordered = [...samples].sort((left, right) => left.timeMs - right.timeMs);
      for (let index = 0; index < count; index += 1) {
        const sample = ordered[index];
        times[index] = sample.timeMs / 1000;
        up[index] = sample.up;
        down[index] = sample.down;
      }
    }
    return [times, up, down] as uPlot.AlignedData;
  }, [samples]);
  const dataRef = useRef<uPlot.AlignedData>(data);
  dataRef.current = data;
  const [tooltip, setTooltip] = useState<ChartTooltipState>({
    show: false,
    left: 0,
    top: 0,
    rows: [],
    time: "",
  });
  const tooltipHooks = useMemo(
    () =>
      buildChartTooltipHooks({
        dataRef,
        rangeHours: 24,
        estimatedWidth: 184,
        setTooltip,
        buildRows: (index) => [
          {
            label: "上行",
            value: formatByteRateLabel(Number(dataRef.current[1]?.[index] ?? 0)),
            color: UP_COLOR,
          },
          {
            label: "下行",
            value: formatByteRateLabel(Number(dataRef.current[2]?.[index] ?? 0)),
            color: DOWN_COLOR,
          },
        ],
      }),
    [],
  );
  // base options 只随断点/主题变化;宽度变化时嵌套引用保持稳定,uplot-react 才会走
  // setSize 而不是整图销毁重建(与 LoadChart/PingChart 同一模式)。
  const compact = w < 560;
  const baseOptions = useMemo<Omit<uPlot.Options, "width" | "height">>(() => {
    const isDark = resolvedAppearance === "dark";
    const { grid, text } = getAxisColors(isDark);
    return {
      // uPlot 会把首尾刻度居中绘制在分割线上。给左右两端留出独立安全区，
      // 避免较长的速率标签和最后一个时间刻度被容器裁掉。
      padding: [8, compact ? 18 : 28, 8, compact ? 4 : 6],
      cursor: { drag: { x: false, y: false } },
      legend: { show: false },
      scales: {
        x: { time: true },
        y: { auto: true },
      },
      axes: [
        {
          stroke: text,
          grid: { stroke: grid, width: 1 },
          ticks: { stroke: grid },
          size: 36,
          values: createTimeAxisFormatter(24),
        },
        {
          stroke: text,
          grid: { stroke: grid, width: 1 },
          ticks: { stroke: grid },
          size: compact ? 70 : 82,
          values: (_self, splits) => splits.map(axisRate),
        },
      ],
      series: [
        { label: "时间" },
        {
          label: "上行",
          stroke: UP_COLOR,
          fill: `${UP_COLOR}12`,
          width: 1.8,
          points: { show: false },
        },
        {
          label: "下行",
          stroke: DOWN_COLOR,
          width: 1.8,
          points: { show: false },
        },
      ],
      hooks: {
        init: [
          (plot) => {
            plot.root.setAttribute("role", "img");
            plot.root.setAttribute("aria-label", "本日网络上行与下行速率折线图");
          },
          tooltipHooks.onInit,
        ],
        destroy: [tooltipHooks.onDestroy],
        setCursor: [tooltipHooks.onSetCursor],
      },
    };
  }, [compact, resolvedAppearance, tooltipHooks]);
  const options = useMemo<uPlot.Options>(
    () => ({ ...baseOptions, width: w, height }) as uPlot.Options,
    [baseOptions, height, w],
  );

  return (
    <div className="traffic-rate-chart">
      <div className="traffic-rate-chart-legend" aria-hidden>
        <span><i style={{ background: UP_COLOR }} />上行</span>
        <span><i style={{ background: DOWN_COLOR }} />下行</span>
      </div>
      <div ref={chartSizeRef} className="traffic-rate-chart-canvas">
        <UplotReact options={options} data={data} />
        <ChartTooltip tooltip={tooltip} />
      </div>
    </div>
  );
}
