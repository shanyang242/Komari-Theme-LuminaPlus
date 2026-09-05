import { useEffect, useMemo, useRef, useState } from "react";
import UplotReact from "uplot-react";
import type uPlot from "uplot";
import { Eye, EyeOff, RefreshCw } from "lucide-react";
import { usePingRecords } from "@/hooks/useRecords";
import { InstancePanel, InstanceChartLoading } from "./InstancePanel";
import {
  buildChartTooltipHooks,
  colorForSeries,
  createTimeAxisFormatter,
  getAxisColors,
  toChartSeconds,
  useResponsiveChartSize,
  type ChartTooltipState,
} from "./chartShared";
import { ChartTooltip, SwitchToggle } from "./ChartParts";
import { alignPingChartRecords } from "./pingChartData";
import {
  cutPeakValues,
  detectTypicalIntervalSeconds,
  downsampleAligned,
  downsampleWeightedAligned,
  insertMetricGapSentinels,
  smoothByCount,
} from "./chartData";
import { latencyHeatColor, lossHeatColor } from "@/utils/metricTone";
import { historyChartRangeSeconds, historyCoverageLabel } from "@/utils/historyRange";
import {
  resolvePingChartInterval,
  resolvePingSampleCounts,
} from "@/utils/pingMetrics";
import { usePreferences } from "@/hooks/usePreferences";
import type { PingRecord, PingTaskStats } from "@/types/komari";

interface WeightedLatency {
  value: number;
  weight: number;
}

function valueAtWeightedIndex(sorted: WeightedLatency[], index: number) {
  let offset = 0;
  for (const sample of sorted) {
    offset += sample.weight;
    if (index < offset) return sample.value;
  }
  return sorted[sorted.length - 1]?.value ?? null;
}

function percentileFromWeighted(sorted: WeightedLatency[], ratio: number) {
  const total = sorted.reduce((sum, sample) => sum + sample.weight, 0);
  if (total <= 0) return null;
  const index = (total - 1) * ratio;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const lowerValue = valueAtWeightedIndex(sorted, lower);
  const upperValue = valueAtWeightedIndex(sorted, upper);
  if (lowerValue == null || upperValue == null) return null;
  if (lower === upper) return lowerValue;
  const weight = index - lower;
  return lowerValue + (upperValue - lowerValue) * weight;
}

export function summarizePingRecords(records: PingRecord[]) {
  const samples = records.map((record) => ({
    record,
    ...resolvePingSampleCounts(record),
  }));
  const valid = samples
    .filter(({ record, valid: count }) => record.value >= 0 && count > 0)
    .map(({ record, valid: count }) => ({ value: record.value, weight: count }))
    .sort((a, b) => a.value - b.value);
  const total = samples.reduce((sum, sample) => sum + sample.total, 0);
  const lost = samples.reduce((sum, sample) => sum + sample.lost, 0);
  const validCount = valid.reduce((sum, sample) => sum + sample.weight, 0);

  let latest: number | null = null;
  for (let index = samples.length - 1; index >= 0; index -= 1) {
    const { record, valid: count } = samples[index];
    if (record.value >= 0 && count > 0) {
      latest = record.value;
      break;
    }
  }

  return {
    latest,
    avg:
      validCount > 0
        ? valid.reduce((sum, sample) => sum + sample.value * sample.weight, 0) / validCount
        : null,
    min: valid[0]?.value ?? null,
    max: valid[valid.length - 1]?.value ?? null,
    p50: percentileFromWeighted(valid, 0.5),
    p99: percentileFromWeighted(valid, 0.99),
    total,
    lost,
    loss: total > 0 ? (lost / total) * 100 : 0,
  };
}

const EMPTY_PING_STATS: PingTaskStats[] = [];
const MAX_RENDER_POINTS = 160;
// 1 即关闭平滑(smoothByCount 对 <=1 原样返回);保留常量便于调参,非削峰模式当前不平滑。
const SMOOTH_WINDOW_POINTS = 1;
const SMOOTH_WINDOW_POINTS_PEAK = 13;

export function PingChart({
  uuid,
  hours,
  active = true,
}: {
  uuid: string;
  hours: number;
  active?: boolean;
}) {
  const {
    data,
    isError,
    isFetching,
    isLoading,
    refetch: refetchRecords,
  } = usePingRecords(uuid, hours, active);
  // stats 随 records 同一次请求返回(getPingRecords includeStats),不再单独发起查询。
  const pingStats = data?.stats ?? EMPTY_PING_STATS;
  const { resolvedAppearance } = usePreferences();
  const { w, h, ref: chartSizeRef } = useResponsiveChartSize("wide");
  const [hiddenTasks, setHiddenTasks] = useState<Set<number>>(new Set());
  const [chartMetric, setChartMetric] = useState<"latency" | "loss">("latency");
  const [connectNulls, setConnectNulls] = useState(false);
  const [cutPeak, setCutPeak] = useState(false);
  const chartRef = useRef<uPlot.AlignedData>([[]]);
  const [tooltip, setTooltip] = useState<ChartTooltipState>({
    show: false,
    left: 0,
    top: 0,
    rows: [],
    time: "",
  });
  const isDark = resolvedAppearance === "dark";
  // API 顺序与后台任务权重一致，响应本身不一定包含可重排的权重。
  const tasks = useMemo(() => [...(data?.tasks ?? [])], [data]);
  const taskLabels = useMemo(() => {
    const counts = new Map<string, number>();
    for (const task of tasks) {
      const label = task.name || `任务 #${task.id}`;
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return new Map(
      tasks.map((task) => {
        const baseLabel = task.name || `任务 #${task.id}`;
        const label = (counts.get(baseLabel) ?? 0) > 1 ? `${baseLabel} #${task.id}` : baseLabel;
        return [task.id, label] as const;
      }),
    );
  }, [tasks]);
  const taskColors = useMemo(
    () => new Map(tasks.map((task, index) => [task.id, colorForSeries(index, tasks.length)] as const)),
    [tasks],
  );
  const taskKeySet = useMemo(() => new Set(tasks.map((task) => String(task.id))), [tasks]);
  const taskKeys = useMemo(() => tasks.map((task) => String(task.id)), [tasks]);
  const taskIndexById = useMemo(
    () => new Map(tasks.map((task, index) => [task.id, index] as const)),
    [tasks],
  );
  const visibleTasks = useMemo(
    () => tasks.filter((task) => !hiddenTasks.has(task.id)),
    [hiddenTasks, tasks],
  );
  const visibleTaskIds = useMemo(
    () => new Set(visibleTasks.map((task) => task.id)),
    [visibleTasks],
  );

  useEffect(() => {
    setHiddenTasks(new Set());
  }, [uuid]);

  useEffect(() => {
    setHiddenTasks((prev) => {
      const validTaskIds = new Set(tasks.map((task) => task.id));
      const next = new Set([...prev].filter((taskId) => validTaskIds.has(taskId)));
      return next.size === prev.size ? prev : next;
    });
  }, [tasks]);

  // 只依赖 data:切换削峰等开关时不重跑解析/排序。
  const sortedRecords = useMemo(
    () =>
      (data?.records ?? [])
        .map((record) => ({
          record,
          time: toChartSeconds(record.time),
        }))
        .filter(({ time }) => time > 0)
        .sort((left, right) => left.time - right.time),
    [data],
  );

  const chartPoints = useMemo(() => {
    if (!data?.records.length || !tasks.length) return null;
    const taskIntervals = tasks
      .map((task) => task.interval)
      .filter((value): value is number => typeof value === "number" && value > 0);
    const detectedInterval = detectTypicalIntervalSeconds(
      sortedRecords.map(({ time }) => time),
      60,
    );
    const fallbackInterval = resolvePingChartInterval(
      data.intervalSeconds,
      taskIntervals.length > 0 ? Math.min(...taskIntervals) : null,
      detectedInterval,
    );
    const tolerance = Math.min(6, Math.max(0.8, fallbackInterval * 0.25));

    const gapOptions = {
      intervals: new Map(
        tasks.map((task) => [
          String(task.id),
          resolvePingChartInterval(data.intervalSeconds, task.interval, fallbackInterval),
        ] as const),
      ),
      defaultInterval: fallbackInterval,
      matchToleranceRatio: 0.25,
    };

    return {
      ...alignPingChartRecords(sortedRecords, taskKeySet, tolerance),
      gapOptions,
    };
  }, [data, sortedRecords, taskKeySet, tasks]);

  // 对齐结果独立缓存；仅对当前指标执行断点处理和降采样，削峰不影响丢包率。
  const latencyChart = useMemo(() => {
    if (!chartPoints || chartMetric !== "latency") return null;
    let points = chartPoints.latencyPoints;
    if (cutPeak && taskKeys.length > 0) {
      points = cutPeakValues(points, taskKeys);
    }
    points = insertMetricGapSentinels(points, chartPoints.gapOptions);
    const times = points.map((point) => point.time);
    // undefined 表示错相采样，null 表示真实断点。
    const perTask = taskKeys.map((taskKey) =>
      points.map((point) => point[taskKey]),
    );

    const reduced = downsampleAligned(times, perTask, MAX_RENDER_POINTS, !cutPeak);
    const smoothed = smoothByCount(
      reduced.perTask,
      cutPeak ? SMOOTH_WINDOW_POINTS_PEAK : SMOOTH_WINDOW_POINTS,
    );

    return [reduced.times, ...smoothed] as uPlot.AlignedData;
  }, [chartMetric, chartPoints, cutPeak, taskKeys]);

  const lossChart = useMemo(() => {
    if (!chartPoints || chartMetric !== "loss") return null;
    const lossPoints = insertMetricGapSentinels(
      chartPoints.lossPoints,
      chartPoints.gapOptions,
    );
    const lossTimes = lossPoints.map((point) => point.time);
    const lossPerTask = taskKeys.map((taskKey) =>
      lossPoints.map((point) => point[taskKey]),
    );
    const lossWeights = taskKeys.map((taskKey) =>
      lossPoints.map((point) => chartPoints.lossWeightMap.get(point.time)?.[taskKey]),
    );
    const reducedLoss = downsampleWeightedAligned(
      lossTimes,
      lossPerTask,
      lossWeights,
      MAX_RENDER_POINTS,
    );
    return [reducedLoss.times, ...reducedLoss.perTask] as uPlot.AlignedData;
  }, [chartMetric, chartPoints, taskKeys]);

  const chart = chartMetric === "loss" ? lossChart : latencyChart;

  useEffect(() => {
    if (chart) chartRef.current = chart;
  }, [chart]);

  const requestedXRange = useMemo(() => historyChartRangeSeconds(data), [data]);
  const coverageMeta = useMemo(() => {
    if (!data) return null;
    const taskIntervals = tasks
      .map((task) => task.interval)
      .filter((value) => Number.isFinite(value) && value > 0);
    return {
      rangeStartMs: data.rangeStartMs,
      rangeEndMs: data.rangeEndMs,
      intervalSeconds:
        data.intervalSeconds ??
        (taskIntervals.length > 0 ? Math.min(...taskIntervals) : undefined),
    };
  }, [data, tasks]);
  const coverageLabel = useMemo(() => {
    const times = chart?.[0];
    if (!times?.length) return null;
    return historyCoverageLabel(coverageMeta, times[0], times[times.length - 1]);
  }, [chart, coverageMeta]);

  const yRange = useMemo<[number | null, number | null]>(() => {
    if (!chart) return [null, null];
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < tasks.length; index += 1) {
      if (!visibleTaskIds.has(tasks[index].id)) continue;
      const series = chart[index + 1] as Array<number | null | undefined> | undefined;
      if (!series) continue;
      for (const value of series) {
        if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
          if (value < min) min = value;
          if (value > max) max = value;
        }
      }
    }
    if (chartMetric === "loss") {
      if (max === Number.NEGATIVE_INFINITY || max <= 5) return [0, 5];
      if (max <= 10) return [0, 10];
      if (max <= 25) return [0, 25];
      if (max <= 50) return [0, 50];
      return [0, 100];
    }
    if (min === Number.POSITIVE_INFINITY) return [0, 100];
    if (min === max) {
      const pad = Math.max(5, min * 0.1);
      return [Math.max(0, min - pad), max + pad];
    }
    const pad = Math.max(5, (max - min) * 0.12);
    return [Math.max(0, min - pad), max + pad];
  }, [chart, chartMetric, tasks, visibleTaskIds]);

  const baseOptions = useMemo<Omit<uPlot.Options, "width" | "height"> | null>(() => {
    if (!chart) return null;
    const { grid, text } = getAxisColors(isDark);
    const tooltipHooks = buildChartTooltipHooks({
      dataRef: chartRef,
      rangeHours: hours,
      estimatedWidth: 196,
      setTooltip,
      buildRows: (idx) =>
        visibleTasks
          .map((task) => {
            const taskIndex = taskIndexById.get(task.id) ?? 0;
            const raw = chartRef.current[taskIndex + 1]?.[idx] as number | null | undefined;
            return {
              label: taskLabels.get(task.id) ?? `任务 #${task.id}`,
              raw: typeof raw === "number" && Number.isFinite(raw) ? raw : null,
              color: taskColors.get(task.id) ?? colorForSeries(taskIndex, tasks.length),
            };
          })
          .sort((a, b) => {
            if (a.raw == null) return b.raw == null ? 0 : 1;
            if (b.raw == null) return -1;
            return b.raw - a.raw;
          })
          .map(({ label, raw, color }) => ({
            label,
            value:
              raw == null
                ? "—"
                : chartMetric === "loss"
                  ? `${raw.toFixed(1)}%`
                  : `${raw.toFixed(1)} ms`,
            color,
          })),
    });
    return {
      padding: [10, 14, 12, 2],
      cursor: { drag: { x: true, y: false } },
      legend: { show: false },
      scales: {
        x: requestedXRange
          ? { time: true, auto: false, range: () => requestedXRange }
          : { time: true },
        y: { auto: false, range: yRange },
      },
      axes: [
        {
          stroke: text,
          grid: { stroke: grid, width: 1 },
          ticks: { stroke: grid },
          size: 36,
          values: createTimeAxisFormatter(hours),
        },
        {
          stroke: text,
          grid: { stroke: grid, width: 1 },
          ticks: { stroke: grid },
          size: 54,
          values: (_self, splits) =>
            splits.map((value) =>
              chartMetric === "loss"
                ? `${Number(value.toFixed(1))}%`
                : value === 0
                  ? ""
                  : `${Math.round(value)} ms`,
            ),
        },
      ],
      series: [
        { label: "time" },
        ...tasks.map((task, index) => ({
          label: taskLabels.get(task.id) ?? `任务 #${task.id}`,
          stroke: taskColors.get(task.id) ?? colorForSeries(index, tasks.length),
          width: 1.7,
          spanGaps: connectNulls,
          show: !hiddenTasks.has(task.id),
          points: { show: false },
        })),
      ],
      hooks: {
        init: [
          (u) => {
            u.root.setAttribute("role", "img");
            u.root.setAttribute(
              "aria-label",
              `Ping ${chartMetric === "loss" ? "丢包率" : "延迟"}历史图表，共 ${tasks.length} 条线路`,
            );
          },
          tooltipHooks.onInit,
        ],
        destroy: [tooltipHooks.onDestroy],
        setCursor: [tooltipHooks.onSetCursor],
      },
    };
  }, [chart, chartMetric, connectNulls, hiddenTasks, hours, isDark, requestedXRange, taskColors, taskIndexById, taskLabels, tasks, visibleTasks, yRange]);

  const options = useMemo<uPlot.Options | null>(
    () => (baseOptions ? { ...baseOptions, width: w, height: h } : null),
    [baseOptions, w, h],
  );

  const taskStats = useMemo(() => {
    const grouped = new Map<number, PingRecord[]>();
    // 复用已按时间升序的 sortedRecords,分组后桶内天然有序,免去逐桶重排序和重复 Date.parse。
    for (const { record } of sortedRecords) {
      const bucket = grouped.get(record.task_id);
      if (bucket) bucket.push(record);
      else grouped.set(record.task_id, [record]);
    }

    const serverStats = new Map(
      pingStats
        .filter((stat) => !stat.client || stat.client === uuid)
        .map((stat) => [stat.taskId, stat] as const),
    );

    return tasks.map((task, index) => {
      const records = grouped.get(task.id) ?? [];
      const server = serverStats.get(task.id);
      // server stats 命中时跳过本地全量统计(排序/分位数不便宜)。
      const fallback = server ? null : summarizePingRecords(records);
      const latest = server ? server.latest : fallback?.latest ?? null;
      const avg = server ? server.avg : fallback?.avg ?? null;
      const min = server ? server.min : fallback?.min ?? null;
      const max = server ? server.max : fallback?.max ?? null;
      const p50 = server ? server.p50 : fallback?.p50 ?? null;
      const p99 = server ? server.p99 : fallback?.p99 ?? null;
      const fallbackVolatility =
        p50 != null && p99 != null
          ? Math.max(0, p99 - p50) / Math.min(50, Math.max(10, p50))
          : null;
      const volatility =
        server && Number.isFinite(server.p99P50Ratio)
          ? server.p99P50Ratio
          : fallbackVolatility;
      const total = server?.total ?? fallback?.total ?? 0;
      const lost = server
        ? Math.max(0, server.total - server.valid)
        : fallback?.lost ?? 0;
      const loss = server?.loss ?? (total > 0 ? fallback?.loss ?? 0 : task.loss);
      return {
        ...task,
        latest,
        avg,
        min,
        max,
        p50,
        p99,
        volatility,
        total,
        lost,
        loss,
        color: taskColors.get(task.id) ?? colorForSeries(index, tasks.length),
      };
    });
  }, [pingStats, sortedRecords, taskColors, tasks, uuid]);

  const refetchAll = () => {
    void refetchRecords();
  };

  const toggleTask = (taskId: number) => {
    setHiddenTasks((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  const toggleAll = () => {
    setHiddenTasks((prev) => (prev.size === 0 ? new Set(tasks.map((task) => task.id)) : new Set()));
  };

  if (isLoading) {
    return <InstanceChartLoading title="Ping 图表" />;
  }

  if (isError && !data?.records.length) {
    return (
      <InstancePanel title="Ping 图表">
        <div className="instance-empty">
          <span>延迟历史加载失败</span>
          <button
            type="button"
            className="instance-toggle-button"
            onClick={refetchAll}
            disabled={isFetching}
            aria-busy={isFetching}
          >
            {isFetching ? "重试中" : "重试"}
          </button>
        </div>
      </InstancePanel>
    );
  }

  if (!data?.records.length) {
    return (
      <InstancePanel title="Ping 图表">
        <div className="instance-empty">暂无延迟记录</div>
      </InstancePanel>
    );
  }

  return (
    <InstancePanel title="Ping 图表" description={coverageLabel ?? undefined}>
      <div className="instance-ping-toolbar">
        <div className="instance-segmented instance-ping-metric-switch" aria-label="Ping 图表指标">
          <button
            type="button"
            data-active={chartMetric === "latency" ? "true" : "false"}
            aria-pressed={chartMetric === "latency"}
            onClick={() => setChartMetric("latency")}
          >
            延迟
          </button>
          <button
            type="button"
            data-active={chartMetric === "loss" ? "true" : "false"}
            aria-pressed={chartMetric === "loss"}
            onClick={() => setChartMetric("loss")}
          >
            丢包率
          </button>
        </div>
        {chartMetric === "latency" && (
          <SwitchToggle
            label="削峰平滑"
            active={cutPeak}
            onToggle={() => setCutPeak((value) => !value)}
            title="对尖峰值做轻度平滑，仅影响图线显示"
          />
        )}
        <SwitchToggle
          label="断点连线"
          active={connectNulls}
          onToggle={() => setConnectNulls((value) => !value)}
          title="关闭：如实显示中断/丢包断点；开启：跨过所有空缺连成完整曲线（更好看，但看不出掉线）。注：偶尔漏一两次采样的小空缺始终自动桥接，不受此开关影响。"
        />
        <button type="button" className="instance-toggle-button" onClick={toggleAll}>
          {hiddenTasks.size === 0 ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />}
          {hiddenTasks.size === 0 ? "隐藏全部" : "显示全部"}
        </button>
        <button
          type="button"
          className="instance-toggle-button"
          onClick={refetchAll}
          disabled={isFetching}
          aria-busy={isFetching}
        >
          <RefreshCw size={14} aria-hidden />
          {isFetching ? "刷新中" : isError ? "刷新失败，重试" : "刷新"}
        </button>
      </div>

      <div className="instance-ping-tasks">
        {taskStats.map((task) => {
          const visible = !hiddenTasks.has(task.id);
          return (
            <button
              key={task.id}
              type="button"
              className="instance-ping-task"
              data-visible={visible ? "true" : "false"}
              aria-pressed={visible}
              onClick={() => toggleTask(task.id)}
              style={{ borderColor: visible ? task.color : "var(--border-subtle)" }}
              title={[
                taskLabels.get(task.id) ?? `任务 #${task.id}`,
                `当前 ${task.latest != null ? `${task.latest.toFixed(1)} ms` : "—"} | 均值 ${task.avg != null ? `${task.avg.toFixed(1)} ms` : "—"} | 丢包 ${task.loss.toFixed(1)}%`,
                `p99 ${task.p99 != null ? `${task.p99.toFixed(0)} ms` : "—"} | 抖动 ${task.volatility != null ? task.volatility.toFixed(2) : "—"}`,
                `min ${task.min != null ? `${task.min.toFixed(0)} ms` : "—"} | max ${task.max != null ? `${task.max.toFixed(0)} ms` : "—"} | 样本 ${task.total ?? 0} | 间隔 ${task.interval}s`,
              ].join("\n")}
            >
              <span className="instance-ping-task-dot" style={{ background: task.color }} aria-hidden />
              <span className="instance-ping-task-name">{taskLabels.get(task.id) ?? `任务 #${task.id}`}</span>
              <span
                className="instance-ping-task-primary"
                style={{
                  color:
                    task.latest != null
                      ? latencyHeatColor(task.latest)
                      : "var(--text-tertiary)",
                }}
              >
                {task.latest != null ? `${task.latest.toFixed(1)} ms` : "—"}
              </span>
              <span
                className="instance-ping-task-loss"
                style={{ color: lossHeatColor(task.loss) }}
              >
                {task.loss.toFixed(1)}%
              </span>
            </button>
          );
        })}
      </div>

      <div ref={chartSizeRef} className="instance-uplot-wrap is-large">
        {chart && options && visibleTasks.length > 0 ? (
          <>
            <UplotReact
              key={`${uuid}-${hours}-${chartMetric}-${cutPeak ? "smooth" : "raw"}-${connectNulls ? "span" : "gap"}`}
              options={options}
              data={chart}
            />
            <ChartTooltip tooltip={tooltip} />
          </>
        ) : (
          <div className="instance-empty">当前已隐藏全部线路，点击上方按钮可恢复显示</div>
        )}
      </div>
    </InstancePanel>
  );
}
