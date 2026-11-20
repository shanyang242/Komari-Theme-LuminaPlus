import { parseTimestampMs } from "@/utils/format";

interface HistoryRangeMeta {
  rangeStartMs?: number;
  rangeEndMs?: number;
  intervalSeconds?: number;
}

type HistoryTimeValue = string | number;

function finitePositive(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function extractSortedPositiveIntervals(timesSeconds: Iterable<number>): number[] {
  const unique = Array.from(
    new Set(Array.from(timesSeconds).filter((time) => Number.isFinite(time))),
  ).sort((left, right) => left - right);
  const intervals: number[] = [];
  for (let index = 1; index < unique.length; index += 1) {
    const seconds = unique[index] - unique[index - 1];
    if (seconds > 0) intervals.push(seconds);
  }
  return intervals.sort((left, right) => left - right);
}

export function medianValue(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

export function inferMedianIntervalSeconds(timesSeconds: Iterable<number>): number | undefined {
  const sorted = extractSortedPositiveIntervals(timesSeconds);
  if (sorted.length === 0) return undefined;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/** 推导典型采样周期（偶数取上中位数以宽容边缘损失）。 */
export function inferHistoryIntervalSeconds(
  records: Array<{ time: HistoryTimeValue }>,
) {
  const sorted = extractSortedPositiveIntervals(
    records
      .map((record) => parseTimestampMs(record.time) / 1000)
      .filter((seconds) => seconds > 0),
  );
  return sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)] : undefined;
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
