interface HistoryRangeMeta {
  rangeStartMs?: number;
  rangeEndMs?: number;
  intervalSeconds?: number;
}

type HistoryTimeValue = string | number;

function finitePositive(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function historyTimeMs(value: HistoryTimeValue) {
  if (typeof value === "number") {
    return value > 1_000_000_000_000 ? value : value * 1000;
  }
  return Date.parse(value);
}

/** 从记录时间戳推导典型采样周期，供覆盖率和断点判断补齐边缘区间。 */
export function inferHistoryIntervalSeconds(
  records: Array<{ time: HistoryTimeValue }>,
) {
  const times = Array.from(
    new Set(
      records
        .map((record) => historyTimeMs(record.time))
        .filter((time) => Number.isFinite(time) && time > 0),
    ),
  ).sort((left, right) => left - right);
  const intervals: number[] = [];
  for (let index = 1; index < times.length; index += 1) {
    const seconds = (times[index] - times[index - 1]) / 1000;
    if (seconds > 0) intervals.push(seconds);
  }
  if (intervals.length === 0) return undefined;
  intervals.sort((left, right) => left - right);
  return intervals[Math.floor(intervals.length / 2)];
}

export function historyChartRangeSeconds(
  meta: HistoryRangeMeta | null | undefined,
): [number, number] | null {
  if (!finitePositive(meta?.rangeStartMs) || !finitePositive(meta?.rangeEndMs)) return null;
  const start = (meta?.rangeStartMs ?? 0) / 1000;
  const end = (meta?.rangeEndMs ?? 0) / 1000;
  return end > start ? [start, end] : null;
}

function formatDuration(ms: number) {
  const hours = ms / (60 * 60 * 1000);
  if (hours >= 24) {
    const days = hours / 24;
    return `${Number(days.toFixed(1))} 天`;
  }
  if (hours >= 1) {
    return `${Number(hours.toFixed(1))} 小时`;
  }
  const minutes = Math.max(1, Math.round(ms / 60_000));
  return `${minutes} 分钟`;
}

export function historyCoverageLabel(
  meta: HistoryRangeMeta | null | undefined,
  actualStartSeconds: number | null | undefined,
  actualEndSeconds: number | null | undefined,
) {
  const range = historyChartRangeSeconds(meta);
  if (!range || !finitePositive(actualStartSeconds) || !finitePositive(actualEndSeconds)) {
    return null;
  }
  if ((actualEndSeconds ?? 0) < (actualStartSeconds ?? 0)) return null;

  const requestedMs = (range[1] - range[0]) * 1000;
  const intervalMs = Math.max(0, meta?.intervalSeconds ?? 0) * 1000;
  const actualMs = Math.min(
    requestedMs,
    Math.max(intervalMs, ((actualEndSeconds ?? 0) - (actualStartSeconds ?? 0)) * 1000 + intervalMs),
  );
  const ratio = requestedMs > 0 ? actualMs / requestedMs : 0;
  return ratio >= 0.98
    ? `覆盖完整 ${formatDuration(requestedMs)}`
    : `实际覆盖 ${formatDuration(actualMs)} / ${formatDuration(requestedMs)}`;
}
