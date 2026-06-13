import { useEffect, useMemo, useRef, useState } from "react";
import UplotReact from "uplot-react";
import type uPlot from "uplot";
import { Eye, EyeOff, RefreshCw } from "lucide-react";
import { usePingRecords } from "@/hooks/useRecords";
import { InstancePanel } from "./InstancePanel";
import {
  colorForSeries,
  formatHourMinuteAxis,
  formatTooltipTime,
  getChartTooltipPosition,
  toChartSeconds,
  useResponsiveChartSize,
  type ChartTooltipState,
} from "./chartShared";
import {
  cutPeakValues,
  detectTypicalIntervalMs,
  insertMetricGapSentinels,
} from "./chartData";
import { latencyHeatColor, lossHeatColor } from "@/utils/metricTone";
import { usePreferences } from "@/hooks/usePreferences";
import type { PingRecord } from "@/types/komari";
import type { TimedMetricPoint } from "./chartData";

// Caller passes an ascending-sorted array so min/max/p50/p99 all reuse one sort
// instead of re-sorting (and instead of `Math.min(...values)`, which can throw
// RangeError when spreading a large series).
function percentileFromSorted(sorted: number[], ratio: number) {
  if (sorted.length === 0) return null;
  const index = (sorted.length - 1) * ratio;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  const weight = index - lower;
  return sorted[lower] + (sorted[upper] - sorted[lower]) * weight;
}

export function PingChart({
  uuid,
  hours,
  active = true,
}: {
  uuid: string;
  hours: number;
  active?: boolean;
}) {
  const { data, isLoading, refetch } = usePingRecords(uuid, hours, active);
  const { resolvedAppearance } = usePreferences();
  const { w, h } = useResponsiveChartSize("wide");
  const [hiddenTasks, setHiddenTasks] = useState<Set<number>>(new Set());
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
  const tasks = useMemo(() => [...(data?.tasks ?? [])].sort((a, b) => a.id - b.id), [data]);
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
    () => new Map(tasks.map((task, index) => [task.id, colorForSeries(index)] as const)),
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

  const chart = useMemo(() => {
    // Build the full aligned series for every task. Visibility is applied via
    // each series' `show` flag (and the render gate), so toggling a line never
    // re-runs this bucketing pipeline.
    if (!data?.records.length || !tasks.length) return null;
    const pointMap = new Map<number, TimedMetricPoint>();
    const sortedRecords = data.records
      .map((record) => ({
        record,
        time: toChartSeconds(record.time),
      }))
      .filter(({ time }) => time > 0)
      .sort((left, right) => left.time - right.time);
    const taskIntervals = tasks
      .map((task) => task.interval)
      .filter((value): value is number => typeof value === "number" && value > 0);
    const fallbackInterval = taskIntervals.length > 0
      ? Math.min(...taskIntervals)
      : detectTypicalIntervalMs(sortedRecords.map(({ time }) => time), 60);
    const tolerance = Math.min(6, Math.max(0.8, fallbackInterval * 0.25));

    // Records are time-sorted and anchors are always more than `tolerance` apart
    // (a new anchor is only created when no existing one is within tolerance), so
    // at most one anchor can match a record and it is always the most recent one.
    // That makes this an O(n) merge instead of the previous O(records × anchors).
    let lastAnchor = Number.NEGATIVE_INFINITY;
    for (const { record, time } of sortedRecords) {
      if (!taskKeySet.has(String(record.task_id))) continue;
      const anchor = time - lastAnchor <= tolerance ? lastAnchor : time;
      if (anchor === time) lastAnchor = time;
      const current = pointMap.get(anchor) ?? { time: anchor };
      current[String(record.task_id)] = record.value > 0 ? record.value : null;
      pointMap.set(anchor, current);
    }

    let chartPoints = [...pointMap.values()].sort((a, b) => a.time - b.time);
    if (cutPeak && taskKeys.length > 0) {
      chartPoints = cutPeakValues(chartPoints, taskKeys);
    }
    chartPoints = insertMetricGapSentinels(chartPoints, {
      intervals: new Map(
        tasks
          .filter((task) => typeof task.interval === "number" && task.interval > 0)
          .map((task) => [String(task.id), task.interval] as const),
      ),
      defaultInterval: fallbackInterval,
      matchToleranceRatio: 0.25,
    });
    const times = chartPoints.map((point) => point.time);
    const perTask = taskKeys.map((taskKey) =>
      chartPoints.map((point) => point[taskKey] ?? null),
    );

    return [times, ...perTask] as uPlot.AlignedData;
  }, [cutPeak, data, taskKeySet, taskKeys, tasks]);

  useEffect(() => {
    if (chart) chartRef.current = chart;
  }, [chart]);

  const yRange = useMemo<[number | null, number | null]>(() => {
    if (!chart) return [null, null];
    // Single-pass min/max — avoids allocating a flattened values array and the
    // `Math.min(...values)` spread, which can throw RangeError on large series.
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < tasks.length; index += 1) {
      if (!visibleTaskIds.has(tasks[index].id)) continue;
      const series = chart[index + 1] as Array<number | null | undefined> | undefined;
      if (!series) continue;
      for (const value of series) {
        if (typeof value === "number" && Number.isFinite(value) && value > 0) {
          if (value < min) min = value;
          if (value > max) max = value;
        }
      }
    }
    if (min === Number.POSITIVE_INFINITY) return [0, 100];
    if (min === max) {
      const pad = Math.max(5, min * 0.1);
      return [Math.max(0, min - pad), max + pad];
    }
    const pad = Math.max(5, (max - min) * 0.12);
    return [Math.max(0, min - pad), max + pad];
  }, [chart, tasks, visibleTaskIds]);

  // Everything except width/height. uplot-react strips width/height and, when
  // only those differ between renders, calls u.setSize() instead of recreating
  // the chart. Keeping the rest of the options referentially stable across a
  // resize therefore turns a drag-resize into cheap setSize calls rather than a
  // full teardown/rebuild. (Visibility/range changes still rebuild — that's rare
  // and on-click.)
  const baseOptions = useMemo<Omit<uPlot.Options, "width" | "height"> | null>(() => {
    if (!chart) return null;
    const grid = isDark ? "rgba(255,255,255,0.065)" : "rgba(0,0,0,0.08)";
    const text = isDark ? "#a5a5aa" : "#52525b";
    return {
      padding: [10, 14, 12, 2],
      cursor: { drag: { x: true, y: false } },
      legend: { show: false },
      scales: {
        x: { time: true },
        y: { auto: false, range: yRange },
      },
      axes: [
        {
          stroke: text,
          grid: { stroke: grid, width: 1 },
          ticks: { stroke: grid },
          size: 36,
          values: formatHourMinuteAxis,
        },
        {
          stroke: text,
          grid: { stroke: grid, width: 1 },
          ticks: { stroke: grid },
          size: 54,
          values: (_self, splits) => splits.map((value) => (value === 0 ? "" : `${Math.round(value)} ms`)),
        },
      ],
      series: [
        { label: "time" },
        ...tasks.map((task, index) => ({
          label: taskLabels.get(task.id) ?? `任务 #${task.id}`,
          stroke: taskColors.get(task.id) ?? colorForSeries(index),
          width: 1.7,
          spanGaps: connectNulls,
          show: !hiddenTasks.has(task.id),
          points: { show: false },
        })),
      ],
      hooks: {
        init: [
          (u) => {
            u.root.addEventListener("mouseleave", () => {
              setTooltip((prev) => ({ ...prev, show: false }));
            });
          },
        ],
        setCursor: [
          (u) => {
            const idx = u.cursor.idx;
            if (idx == null || idx < 0 || !chart) {
              setTooltip((prev) => ({ ...prev, show: false }));
              return;
            }
            const currentChart = chartRef.current;
            const timestamp = currentChart[0]?.[idx];
            if (typeof timestamp !== "number") {
              setTooltip((prev) => ({ ...prev, show: false }));
              return;
            }
            const bbox = u.root.getBoundingClientRect();
            const anchorX = u.valToPos(timestamp, "x");
            const rows = visibleTasks.map((task) => {
              const taskIndex = taskIndexById.get(task.id) ?? 0;
              const value = currentChart[taskIndex + 1]?.[idx] as number | null | undefined;
              return {
                label: taskLabels.get(task.id) ?? `任务 #${task.id}`,
                value: value == null ? "—" : `${value.toFixed(1)} ms`,
                color: taskColors.get(task.id) ?? colorForSeries(taskIndex),
              };
            });
            const anchorY = typeof u.cursor.top === "number" ? u.cursor.top : bbox.height * 0.5;
            const position = getChartTooltipPosition({
              containerWidth: bbox.width,
              containerHeight: bbox.height,
              anchorX,
              anchorY,
              rowCount: rows.length,
              estimatedWidth: 196,
            });
            setTooltip({
              show: true,
              left: position.left,
              top: position.top,
              rows,
              time: formatTooltipTime(timestamp),
            });
          },
        ],
      },
    };
  }, [chart, connectNulls, hiddenTasks, isDark, taskColors, taskIndexById, taskLabels, tasks, visibleTasks, yRange]);

  const options = useMemo<uPlot.Options | null>(
    () => (baseOptions ? { ...baseOptions, width: w, height: h } : null),
    [baseOptions, w, h],
  );

  const taskStats = useMemo(() => {
    const grouped = new Map<number, PingRecord[]>();
    for (const record of data?.records ?? []) {
      const bucket = grouped.get(record.task_id);
      if (bucket) bucket.push(record);
      else grouped.set(record.task_id, [record]);
    }

    for (const records of grouped.values()) {
      records.sort((a, b) => toChartSeconds(a.time) - toChartSeconds(b.time));
    }

    return tasks.map((task, index) => {
      const records = grouped.get(task.id) ?? [];
      const positives = records
        .filter((record) => record.value > 0)
        .map((record) => record.value)
        .sort((a, b) => a - b);
      const latest = [...records].reverse().find((record) => record.value > 0)?.value ?? null;
      const avg = positives.length
        ? positives.reduce((sum, value) => sum + value, 0) / positives.length
        : null;
      const min = positives.length ? positives[0] : null;
      const max = positives.length ? positives[positives.length - 1] : null;
      const p50 = percentileFromSorted(positives, 0.5);
      const p99 = percentileFromSorted(positives, 0.99);
      const volatility = p50 && p50 > 0 && p99 ? p99 / p50 : null;
      const total = records.length;
      const lost = records.filter((record) => record.value <= 0).length;
      const loss = total > 0 ? (lost / total) * 100 : task.loss;
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
        color: taskColors.get(task.id) ?? colorForSeries(index),
      };
    });
  }, [data, taskColors, tasks]);

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
    return <section className="instance-panel h-[260px] animate-pulse" aria-busy />;
  }

  if (!data?.records.length) {
    return (
      <InstancePanel title="Ping 图表">
        <div className="instance-empty">暂无延迟记录</div>
      </InstancePanel>
    );
  }

  return (
    <InstancePanel title="Ping 图表">
      <div className="instance-ping-toolbar">
        <button
          type="button"
          className="instance-toggle-button instance-switch-button"
          data-active={cutPeak ? "true" : "false"}
          onClick={() => setCutPeak((value) => !value)}
          aria-pressed={cutPeak}
          title="对尖峰值做轻度平滑，仅影响图线显示"
        >
          <span className="instance-switch-copy">削峰平滑</span>
          <span className="instance-switch-track" aria-hidden>
            <span className="instance-switch-thumb" />
          </span>
          <span className="instance-switch-state">
            {cutPeak ? "开启" : "关闭"}
          </span>
        </button>
        <button
          type="button"
          className="instance-toggle-button instance-switch-button"
          data-active={connectNulls ? "true" : "false"}
          onClick={() => setConnectNulls((value) => !value)}
          aria-pressed={connectNulls}
        >
          <span className="instance-switch-copy">断点连线</span>
          <span className="instance-switch-track" aria-hidden>
            <span className="instance-switch-thumb" />
          </span>
          <span className="instance-switch-state">
            {connectNulls ? "开启" : "关闭"}
          </span>
        </button>
        <button type="button" className="instance-toggle-button" onClick={toggleAll}>
          {hiddenTasks.size === 0 ? <EyeOff size={14} /> : <Eye size={14} />}
          {hiddenTasks.size === 0 ? "隐藏全部" : "显示全部"}
        </button>
        <button type="button" className="instance-toggle-button" onClick={() => void refetch()}>
          <RefreshCw size={14} />
          刷新
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
              title={`最小 ${task.min != null ? `${task.min.toFixed(1)} ms` : "—"} | 最大 ${task.max != null ? `${task.max.toFixed(1)} ms` : "—"} | 样本 ${task.total ?? 0} | 间隔 ${task.interval}s`}
            >
              <div className="instance-ping-task-head">
                <span className="instance-ping-task-name">{taskLabels.get(task.id) ?? `任务 #${task.id}`}</span>
                <span
                  className="instance-ping-task-primary"
                  style={{ color: task.latest != null ? latencyHeatColor(task.latest) : "var(--text-tertiary)" }}
                >
                  {task.latest != null ? `${task.latest.toFixed(1)} ms` : "—"}
                </span>
              </div>
              <div className="instance-ping-task-stats">
                <span>均值 {task.avg != null ? `${task.avg.toFixed(1)} ms` : "—"}</span>
                <span style={{ color: lossHeatColor(task.loss) }}>丢包 {task.loss.toFixed(1)}%</span>
                <span>p99 {task.p99 != null ? `${task.p99.toFixed(0)} ms` : "—"}</span>
                <span>抖动 {task.volatility != null ? task.volatility.toFixed(2) : "—"}</span>
              </div>
              <div className="instance-ping-task-meta">
                <span>min {task.min != null ? `${task.min.toFixed(0)} ms` : "—"}</span>
                <span>max {task.max != null ? `${task.max.toFixed(0)} ms` : "—"}</span>
                <span>样本 {task.total ?? 0}</span>
                <span>{task.interval}s</span>
              </div>
            </button>
          );
        })}
      </div>

      <div className="instance-uplot-wrap is-large">
        {chart && options && visibleTasks.length > 0 ? (
          <>
            <UplotReact options={options} data={chart} />
            {tooltip.show && (
              <div
                className="instance-chart-tooltip"
                style={{ left: tooltip.left, top: tooltip.top }}
              >
                <div className="instance-chart-tooltip-time">{tooltip.time}</div>
                {tooltip.rows.map((row) => (
                  <div key={`${row.label}-${row.color}`} className="instance-chart-tooltip-row">
                    <span className="instance-chart-tooltip-dot" style={{ background: row.color }} />
                    <span>{row.label}</span>
                    <strong>{row.value}</strong>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="instance-empty">当前已隐藏全部线路，点击上方按钮可恢复显示</div>
        )}
      </div>
    </InstancePanel>
  );
}
