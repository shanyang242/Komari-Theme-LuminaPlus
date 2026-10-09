import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import UplotReact from "uplot-react";
import type uPlot from "uplot";
import { ArrowDown, ArrowUp, Cpu, Gauge, HardDrive, MemoryStick, Network, RefreshCw } from "lucide-react";
import { useLoadRecords } from "@/hooks/useRecords";
import { useNodeMetrics } from "@/hooks/useNode";
import { InstancePanel, InstanceChartLoading } from "./InstancePanel";
import {
  buildChartTooltipHooks,
  CHART_PALETTE,
  createTimeAxisFormatter,
  formatChartCoverageTime,
  getAxisColors,
  toChartSeconds,
  useResponsiveChartSize,
  type ChartTooltipState,
} from "./chartShared";
import { ChartTooltip, SwitchToggle } from "./ChartParts";
import {
  downsampleAligned,
  fillMissingMetricPoints,
  interpolateMetricGaps,
} from "./chartData";
import { formatBytes, formatTrafficRateLabel } from "@/utils/format";
import { historyChartRangeSeconds, historyCoverageLabel } from "@/utils/historyRange";
import { usePreferences } from "@/hooks/usePreferences";
import type { LoadRecord, NodeMetrics } from "@/types/komari";

const LOAD_HISTORY_SAMPLE_LIMIT = 360;
const LOAD_HISTORY_RENDER_LIMIT = 720;
const REALTIME_HISTORY_SEED_LIMIT = 120;
const REALTIME_SAMPLE_LIMIT = 600;

const CPU_KEYS = ["cpu"];
const CPU_COLORS = [CHART_PALETTE.cpu];
const MEMORY_KEYS = ["ram", "swap"];
const MEMORY_COLORS = [CHART_PALETTE.memory, CHART_PALETTE.warning];
const DISK_KEYS = ["disk"];
const DISK_COLORS = [CHART_PALETTE.disk];
const NETWORK_KEYS = ["netIn", "netOut"];
const NETWORK_COLORS = [CHART_PALETTE.success, CHART_PALETTE.cpu];
const PROCESS_KEYS = ["process"];
const PROCESS_COLORS = [CHART_PALETTE.warning];
const SERIES_LABELS: Record<string, string> = {
  cpu: "CPU",
  ram: "内存",
  swap: "Swap",
  disk: "磁盘",
  netIn: "下行",
  netOut: "上行",
  process: "进程",
};
const LOAD_INTERPOLATE_KEYS = [
  "cpu",
  "ram",
  "swap",
  "disk",
  "netIn",
  "netOut",
  "process",
];

interface ChartPoint {
  time: number;
  [key: string]: number | null;
}

function metricData(points: ChartPoint[], keys: string[]): uPlot.AlignedData {
  const times = points.map((point) => point.time);
  return [times, ...keys.map((key) => points.map((point) => point[key] ?? null))] as uPlot.AlignedData;
}

function getHistoryRenderLimit(hours: number) {
  if (hours <= 4) return LOAD_HISTORY_SAMPLE_LIMIT;
  return LOAD_HISTORY_RENDER_LIMIT;
}

const DOWNSAMPLE_KEYS = [
  "cpu",
  "ram",
  "swap",
  "disk",
  "netIn",
  "netOut",
  "process",
] as const;

// 走与 Ping 图同一套时间分桶保峰降采样:抽点式降采样会随机丢掉桶内尖峰,
// 而负载/网速的瞬时突刺正是最需要保留的信息。
function downsamplePoints(points: ChartPoint[], limit: number) {
  if (points.length <= limit || limit < 2) return points;

  const times = points.map((point) => point.time);
  const perKey = DOWNSAMPLE_KEYS.map((key) => points.map((point) => point[key]));
  const reduced = downsampleAligned(times, perKey, limit, true);
  return reduced.times.map((time, index) => {
    const point: ChartPoint = { time };
    DOWNSAMPLE_KEYS.forEach((key, keyIndex) => {
      point[key] = reduced.perTask[keyIndex][index] ?? null;
    });
    return point;
  });
}

function getSeriesLabel(key: string) {
  return SERIES_LABELS[key] ?? key;
}

function pointFromNode(node: NodeMetrics): ChartPoint {
  return {
    time: node.updatedAt > 0 ? node.updatedAt / 1000 : Date.now() / 1000,
    cpu: node.cpuPct,
    // total 为 0 表示该指标不存在(如无 Swap),填 null 让 uPlot 不画线,而不是画一条假的 0%。
    ram: node.ramTotal > 0 ? (node.ramUsed / node.ramTotal) * 100 : null,
    swap: node.swapTotal > 0 ? (node.swapUsed / node.swapTotal) * 100 : null,
    disk: node.diskTotal > 0 ? (node.diskUsed / node.diskTotal) * 100 : null,
    netIn: node.netDown,
    netOut: node.netUp,
    process: node.process,
  };
}

function formatTooltipValue(key: string, value: number | null | undefined, unit: string) {
  if (value == null || !Number.isFinite(value)) return "—";
  if (key === "netIn" || key === "netOut") return formatTrafficRateLabel(value);
  if (unit === "%") return `${value.toFixed(2)}%`;
  if (key === "process") return `${Math.round(value)}`;
  return value.toFixed(2);
}

function formatPercentAxisValue(value: number, min: number, max: number) {
  const span = Math.abs(max - min);
  if (span < 0.5) return `${value.toFixed(2)}%`;
  if (span < 5) return `${value.toFixed(1)}%`;
  return `${Math.round(value)}%`;
}

function formatNetworkAxisValue(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "";
  return formatTrafficRateLabel(value);
}

function formatCountAxisValue(value: number, min: number, max: number) {
  const span = Math.abs(max - min);
  if (span < 10) return value.toFixed(1);
  return `${Math.round(value)}`;
}

// 不含尺寸的配置。width/height 由调用方在另一个 memo 里加上，resize 时只改这两个 key，
// uplot-react 就会调 setSize() 而不是重建整个 chart。(用普通函数而非 hook——它不调任何
// hook；之前的 `use` 前缀会触发 rules-of-hooks lint。)
function buildBaseOptions({
  title,
  keys,
  colors,
  resolvedAppearance,
  rangeHours,
  spanGaps,
  axisKind,
  axisSize = 52,
  xRange,
}: {
  title: string;
  keys: string[];
  colors: string[];
  resolvedAppearance: "light" | "dark";
  rangeHours: number;
  spanGaps?: boolean;
  axisKind: "percent" | "network" | "count";
  axisSize?: number;
  xRange?: [number, number] | null;
}): Omit<uPlot.Options, "width" | "height"> {
  const isDark = resolvedAppearance === "dark";
  const { grid, text } = getAxisColors(isDark);

  return {
    padding: [8, 12, 10, 2],
    cursor: { drag: { x: true, y: false } },
    legend: { show: false },
    scales: {
      x: xRange ? { time: true, auto: false, range: () => xRange } : { time: true },
      y: { auto: true },
    },
    axes: [
      {
        stroke: text,
        grid: { stroke: grid, width: 1 },
        ticks: { stroke: grid },
        size: rangeHours >= 72 ? 38 : 34,
        values: createTimeAxisFormatter(rangeHours),
      },
      {
        stroke: text,
        grid: { stroke: grid, width: 1 },
        ticks: { stroke: grid },
        size: axisSize,
        values: (self, splits) => {
          const min = Number(self.scales.y.min ?? 0);
          const max = Number(self.scales.y.max ?? 0);
          return splits.map((value) => {
            if (value === 0 && axisKind !== "percent") return "";
            if (axisKind === "network") return formatNetworkAxisValue(value);
            if (axisKind === "percent") return formatPercentAxisValue(value, min, max);
            return formatCountAxisValue(value, min, max);
          });
        },
      },
    ],
    series: [
      { label: "time" },
      ...keys.map((key, index) => ({
        label: key,
        stroke: colors[index] ?? colors[0],
        fill: index === 0 ? `${colors[index] ?? colors[0]}22` : undefined,
        width: 1.6,
        spanGaps: spanGaps ?? false,
        points: { show: false },
      })),
    ],
    hooks: {
      init: [
        (u) => {
          u.root.setAttribute("role", "img");
          u.root.setAttribute("aria-label", title);
        },
      ],
    },
  };
}

const ChartCard = memo(function ChartCard({
  icon,
  title,
  value,
  note,
  uuid,
  points,
  keys,
  colors,
  resolvedAppearance,
  rangeHours,
  unit = "",
  spanGaps,
  axisKind,
  axisSize,
  xRange,
}: {
  icon: ReactNode;
  title: string;
  value: ReactNode;
  note?: ReactNode;
  uuid: string;
  points: ChartPoint[];
  keys: string[];
  colors: string[];
  resolvedAppearance: "light" | "dark";
  rangeHours: number;
  unit?: string;
  spanGaps?: boolean;
  axisKind: "percent" | "network" | "count";
  axisSize?: number;
  xRange?: [number, number] | null;
}) {
  const { w, h, ref: chartSizeRef } = useResponsiveChartSize("grid");
  const dataRef = useRef<uPlot.AlignedData>([[]]);
  const [tooltip, setTooltip] = useState<ChartTooltipState>({
    show: false,
    left: 0,
    top: 0,
    rows: [],
    time: "",
  });
  const data = useMemo(() => metricData(points, keys), [points, keys]);
  useLayoutEffect(() => {
    dataRef.current = data;
  }, [data]);
  const baseOptions = useMemo(
    () =>
      buildBaseOptions({
        title,
        keys,
        colors,
        resolvedAppearance,
        rangeHours,
        spanGaps,
        axisKind,
        axisSize,
        xRange,
      }),
    [axisKind, axisSize, colors, keys, rangeHours, resolvedAppearance, spanGaps, title, xRange],
  );

  const enhancedOptions = useMemo<Omit<uPlot.Options, "width" | "height">>(() => {
    const tooltip = buildChartTooltipHooks({
      dataRef,
      rangeHours,
      estimatedWidth: 176,
      setTooltip,
      buildRows: (idx) =>
        keys.map((key, keyIndex) => ({
          label: getSeriesLabel(key),
          value: formatTooltipValue(
            key,
            dataRef.current[keyIndex + 1]?.[idx] as number | null | undefined,
            unit,
          ),
          color: colors[keyIndex] ?? colors[0],
        })),
    });
    return {
      ...baseOptions,
      hooks: {
        ...baseOptions.hooks,
        init: [...(baseOptions.hooks?.init ?? []), tooltip.onInit],
        destroy: [...(baseOptions.hooks?.destroy ?? []), tooltip.onDestroy],
        setCursor: [tooltip.onSetCursor],
      },
    };
  }, [colors, keys, baseOptions, rangeHours, unit]);

  const chartOptions = useMemo<uPlot.Options>(
    () => ({ ...enhancedOptions, width: w, height: h }) as uPlot.Options,
    [enhancedOptions, w, h],
  );

  return (
    <div
      className="instance-chart-card"
      style={{ "--chart-accent": colors[0] } as CSSProperties}
    >
      <header className="instance-chart-card-head">
        <div className="instance-panel-subhead">
          {icon}
          <span>{title}</span>
        </div>
        <div className="instance-series-stats">
          <span className="tabular">{value}</span>
          {note != null && <span className="tabular text-[var(--text-tertiary)]">{note}</span>}
        </div>
      </header>
      <div ref={chartSizeRef} className="instance-uplot-wrap">
        <UplotReact
          key={`${uuid}-${rangeHours}`}
          options={chartOptions}
          data={data}
          resetScales={rangeHours === 0}
        />
        <ChartTooltip tooltip={tooltip} />
      </div>
    </div>
  );
});

export function LoadChart({
  uuid,
  hours,
  active = true,
}: {
  uuid: string;
  hours: number;
  active?: boolean;
}) {
  const queryHours = hours === 0 ? 1 : hours;
  const { data, isError, isFetching, isLoading, refetch } = useLoadRecords(
    uuid,
    queryHours,
    active,
  );
  const isRealtime = hours === 0;
  const node = useNodeMetrics(uuid, isRealtime && active);
  const { resolvedAppearance } = usePreferences();
  const [realtimePoints, setRealtimePoints] = useState<ChartPoint[]>([]);
  const [connectNulls, setConnectNulls] = useState(false);

  useEffect(() => {
    if (!active || !isRealtime || !node) return;
    const point = pointFromNode(node);
    setRealtimePoints((prev) => {
      const last = prev[prev.length - 1];
      if (last && Math.abs(last.time - point.time) < 1) return prev;
      return [...prev, point].slice(-REALTIME_SAMPLE_LIMIT);
    });
  }, [active, isRealtime, node]);

  useEffect(() => {
    setRealtimePoints([]);
  }, [hours, uuid]);

  const historyRecords = useMemo<Array<{ record: LoadRecord; time: number }>>(
    () =>
      (data?.records ?? [])
        .map((record) => ({ record, time: toChartSeconds(record.time) }))
        .filter(({ time }) => time > 0)
        .sort((left, right) => left.time - right.time),
    [data],
  );

  const historyPoints = useMemo<ChartPoint[]>(() => {
    const rawPoints = historyRecords.map(({ record, time }) => ({
        time,
        cpu: record.cpu,
        ram: record.ram_total > 0 ? (record.ram / record.ram_total) * 100 : null,
        swap: record.swap_total > 0 ? (record.swap / record.swap_total) * 100 : null,
        disk: record.disk_total > 0 ? (record.disk / record.disk_total) * 100 : null,
        netIn: record.net_in,
        netOut: record.net_out,
        process: record.process,
      }));
    const sampled = downsamplePoints(rawPoints, getHistoryRenderLimit(hours));
    const filled = fillMissingMetricPoints(sampled);
    return interpolateMetricGaps(filled, LOAD_INTERPOLATE_KEYS) as ChartPoint[];
  }, [historyRecords, hours]);

  const points = useMemo<ChartPoint[]>(() => {
    if (isRealtime) {
      const initial = historyPoints.slice(-REALTIME_HISTORY_SEED_LIMIT);
      const merged = [...initial, ...realtimePoints].sort((a, b) => a.time - b.time);
      const deduped = merged.filter((point, index, arr) => {
        const next = arr[index + 1];
        return !next || Math.abs(next.time - point.time) >= 1;
      });
      return deduped.slice(-REALTIME_SAMPLE_LIMIT);
    }
    return historyPoints;
  }, [historyPoints, isRealtime, realtimePoints]);

  // 最新值取自按时间排好序的 historyRecords。
  const latestHistoryRecord = historyRecords[historyRecords.length - 1]?.record;
  const sourceRecordCount = historyRecords.length;
  const wasDownsampled = !isRealtime && sourceRecordCount > getHistoryRenderLimit(hours);
  const sampleSummary = isRealtime
    ? `${points.length} 个点`
    : wasDownsampled
      ? `${points.length} / ${sourceRecordCount} 个点`
      : `${points.length} 个点`;
  const coverageSummary = points.length
    ? `${formatChartCoverageTime(points[0].time)} - ${formatChartCoverageTime(points[points.length - 1].time)}`
    : "—";
  const requestedXRange = useMemo(
    () => (isRealtime ? null : historyChartRangeSeconds(data)),
    [data, isRealtime],
  );
  const coverageLabel = useMemo(
    () =>
      isRealtime
        ? null
        : historyCoverageLabel(data, points[0]?.time, points[points.length - 1]?.time),
    [data, isRealtime, points],
  );

  if (isLoading) {
    return <InstanceChartLoading title="负载图表" />;
  }

  if (isError && !points.length) {
    return (
      <InstancePanel title="负载图表">
        <div className="instance-empty">
          <span>负载历史加载失败</span>
          <button
            type="button"
            className="instance-toggle-button"
            onClick={() => void refetch()}
            disabled={isFetching}
            aria-busy={isFetching}
          >
            {isFetching ? "重试中" : "重试"}
          </button>
        </div>
      </InstancePanel>
    );
  }

  if (!points.length) {
    return (
      <InstancePanel title="负载图表">
        <div className="instance-empty">暂无负载历史数据</div>
      </InstancePanel>
    );
  }

  return (
    <InstancePanel
      title="负载图表"
      aside={
        <div className="instance-chart-headmeta">
          <div className="instance-chart-meta" aria-label="图表数据范围">
            <span title={coverageSummary}>
              <strong>{coverageLabel ?? `覆盖 ${coverageSummary}`}</strong>
            </span>
            <span>
              采样 <strong>{sampleSummary}</strong>
            </span>
          </div>
          <SwitchToggle
            label="断点连线"
            active={connectNulls}
            onToggle={() => setConnectNulls((value) => !value)}
          />
          <button
            type="button"
            className="instance-toggle-button"
            onClick={() => void refetch()}
            disabled={isFetching}
            aria-busy={isFetching}
          >
            <RefreshCw size={14} aria-hidden />
            {isFetching ? "刷新中" : "刷新"}
          </button>
        </div>
      }
      className="instance-chart-panel"
    >
      <div className="instance-chart-grid">
        <ChartCard
          icon={<Cpu size={13} />}
          title="CPU"
          uuid={uuid}
          value={
            isRealtime && node
              ? `${node.cpuPct.toFixed(2)}%`
              : `${(points[points.length - 1]?.cpu ?? 0).toFixed(2)}%`
          }
          note="使用率"
          points={points}
          keys={CPU_KEYS}
          colors={CPU_COLORS}
          resolvedAppearance={resolvedAppearance}
          rangeHours={hours}
          unit="%"
          spanGaps={connectNulls}
          axisKind="percent"
          xRange={requestedXRange}
        />
        <ChartCard
          icon={<MemoryStick size={13} />}
          title="内存"
          uuid={uuid}
          value={
            isRealtime && node
              ? `${formatBytes(node.ramUsed)} / ${formatBytes(node.ramTotal)}`
              : latestHistoryRecord
                ? `${formatBytes(latestHistoryRecord.ram)} / ${formatBytes(latestHistoryRecord.ram_total)}`
                : "—"
          }
          note={
            isRealtime && node
              ? node.swapTotal
                ? `Swap ${formatBytes(node.swapUsed)} / ${formatBytes(node.swapTotal)}`
                : "Swap 无"
              : latestHistoryRecord && latestHistoryRecord.swap_total > 0
                ? `Swap ${formatBytes(latestHistoryRecord.swap)} / ${formatBytes(latestHistoryRecord.swap_total)}`
                : "Swap 无"
          }
          points={points}
          keys={MEMORY_KEYS}
          colors={MEMORY_COLORS}
          resolvedAppearance={resolvedAppearance}
          rangeHours={hours}
          unit="%"
          spanGaps={connectNulls}
          axisKind="percent"
          xRange={requestedXRange}
        />
        <ChartCard
          icon={<HardDrive size={13} />}
          title="磁盘"
          uuid={uuid}
          value={
            isRealtime && node
              ? `${formatBytes(node.diskUsed)} / ${formatBytes(node.diskTotal)}`
              : latestHistoryRecord
                ? `${formatBytes(latestHistoryRecord.disk)} / ${formatBytes(latestHistoryRecord.disk_total)}`
                : "—"
          }
          note="已用空间"
          points={points}
          keys={DISK_KEYS}
          colors={DISK_COLORS}
          resolvedAppearance={resolvedAppearance}
          rangeHours={hours}
          unit="%"
          spanGaps={connectNulls}
          axisKind="percent"
          xRange={requestedXRange}
        />
        <ChartCard
          icon={<Network size={13} />}
          title="网络"
          uuid={uuid}
          value={
            isRealtime && node
              ? `${formatTrafficRateLabel(node.netDown)} / ${formatTrafficRateLabel(node.netUp)}`
              : latestHistoryRecord
                ? `${formatTrafficRateLabel(latestHistoryRecord.net_in ?? 0)} / ${formatTrafficRateLabel(latestHistoryRecord.net_out ?? 0)}`
                : "—"
          }
          note={
            <span className="instance-overview-multi">
              <span className="inline-flex items-center gap-1"><ArrowDown size={11} />{isRealtime && node ? formatBytes(node.trafficDown) : latestHistoryRecord ? formatBytes(latestHistoryRecord.net_total_down ?? 0) : "—"}</span>
              <span className="inline-flex items-center gap-1"><ArrowUp size={11} />{isRealtime && node ? formatBytes(node.trafficUp) : latestHistoryRecord ? formatBytes(latestHistoryRecord.net_total_up ?? 0) : "—"}</span>
            </span>
          }
          points={points}
          keys={NETWORK_KEYS}
          colors={NETWORK_COLORS}
          resolvedAppearance={resolvedAppearance}
          rangeHours={hours}
          spanGaps={connectNulls}
          axisKind="network"
          axisSize={78}
          xRange={requestedXRange}
        />
        <ChartCard
          icon={<Gauge size={13} />}
          title="进程"
          uuid={uuid}
          value={
            isRealtime && node
              ? node.process.toString()
              : latestHistoryRecord
                ? Math.round(latestHistoryRecord.process ?? 0).toString()
                : "—"
          }
          note={
            isRealtime && node
              ? `负载 ${node.load1.toFixed(2)} | ${node.load5.toFixed(2)} | ${node.load15.toFixed(2)}`
              : latestHistoryRecord
                ? `负载 ${(latestHistoryRecord.load ?? 0).toFixed(2)}`
                : "—"
          }
          points={points}
          keys={PROCESS_KEYS}
          colors={PROCESS_COLORS}
          resolvedAppearance={resolvedAppearance}
          rangeHours={hours}
          spanGaps={connectNulls}
          axisKind="count"
          xRange={requestedXRange}
        />
      </div>
    </InstancePanel>
  );
}
