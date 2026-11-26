import type { LoadRecord } from "@/types/komari";
import { parseTimestampMs } from "@/utils/format";

export const TRAFFIC_UP_METRIC = "traffic.up";
export const TRAFFIC_DOWN_METRIC = "traffic.down";
export const RATE_UP_METRIC = "net.out.rate";
export const RATE_DOWN_METRIC = "net.in.rate";

export const TODAY_TRAFFIC_METRIC_KEYS = [
  TRAFFIC_UP_METRIC,
  TRAFFIC_DOWN_METRIC,
  RATE_UP_METRIC,
  RATE_DOWN_METRIC,
] as const;

export const TODAY_TRAFFIC_AGGREGATION = {
  [TRAFFIC_UP_METRIC]: "sum",
  [TRAFFIC_DOWN_METRIC]: "sum",
  [RATE_UP_METRIC]: "max",
  [RATE_DOWN_METRIC]: "max",
} as const;

export interface TrafficMetricSeries {
  metricKey: string;
  client: string;
  intervalSeconds?: number;
  points: Array<{ time: string; value: number | null; count: number }>;
}

export interface TodayTrafficStat {
  uuid: string;
  trafficUp: number;
  trafficDown: number;
  peakUp: number;
  peakUpAt: number | null;
  peakDown: number;
  peakDownAt: number | null;
  sampleCount: number;
  hasSamples: boolean;
}

export interface TodayTrafficSample {
  timeMs: number;
  up: number;
  down: number;
}

function emptyStat(uuid: string): TodayTrafficStat {
  return {
    uuid,
    trafficUp: 0,
    trafficDown: 0,
    peakUp: 0,
    peakUpAt: null,
    peakDown: 0,
    peakDownAt: null,
    sampleCount: 0,
    hasSamples: false,
  };
}

function validPoint(point: TrafficMetricSeries["points"][number]) {
  return point.count > 0 && point.value != null && Number.isFinite(point.value);
}

export function summarizeTodayTrafficMetrics(
  series: TrafficMetricSeries[],
  uuids: string[],
): TodayTrafficStat[] {
  const stats = new Map(uuids.map((uuid) => [uuid, emptyStat(uuid)] as const));
  const sampleTimes = new Map(uuids.map((uuid) => [uuid, new Set<number>()] as const));

  for (const item of series) {
    const stat = stats.get(item.client);
    if (!stat) continue;
    for (const point of item.points) {
      if (!validPoint(point)) continue;
      const timeMs = parseTimeMs(point.time);
      if (!Number.isFinite(timeMs)) continue;
      const value = Math.max(0, point.value ?? 0);
      sampleTimes.get(item.client)?.add(timeMs);
      stat.hasSamples = true;

      switch (item.metricKey) {
        case TRAFFIC_UP_METRIC:
          stat.trafficUp += value;
          break;
        case TRAFFIC_DOWN_METRIC:
          stat.trafficDown += value;
          break;
        case RATE_UP_METRIC:
          if (value > stat.peakUp) {
            stat.peakUp = value;
            stat.peakUpAt = timeMs;
          }
          break;
        case RATE_DOWN_METRIC:
          if (value > stat.peakDown) {
            stat.peakDown = value;
            stat.peakDownAt = timeMs;
          }
          break;
      }
    }
  }

  for (const [uuid, stat] of stats) {
    stat.sampleCount = sampleTimes.get(uuid)?.size ?? 0;
  }
  return [...stats.values()];
}

export function buildTodayTrafficMetricSamplesByUuid(
  series: TrafficMetricSeries[],
  uuids: readonly string[],
): Record<string, TodayTrafficSample[]> {
  const sampleMaps = new Map<string, Map<number, TodayTrafficSample>>();
  for (const uuid of uuids) {
    sampleMaps.set(uuid, new Map());
  }

  for (const item of series) {
    if (item.metricKey !== RATE_UP_METRIC && item.metricKey !== RATE_DOWN_METRIC) {
      continue;
    }
    const samples = sampleMaps.get(item.client);
    if (!samples) continue;
    for (const point of item.points) {
      if (!validPoint(point)) continue;
      const timeMs = parseTimeMs(point.time);
      if (!Number.isFinite(timeMs)) continue;
      const sample = samples.get(timeMs) ?? { timeMs, up: 0, down: 0 };
      if (item.metricKey === RATE_UP_METRIC) sample.up = Math.max(0, point.value ?? 0);
      else sample.down = Math.max(0, point.value ?? 0);
      samples.set(timeMs, sample);
    }
  }

  const out: Record<string, TodayTrafficSample[]> = {};
  for (const [uuid, samples] of sampleMaps) {
    out[uuid] = [...samples.values()].sort((left, right) => right.timeMs - left.timeMs);
  }
  return out;
}

export function buildTodayTrafficMetricSamples(
  series: TrafficMetricSeries[],
  uuid: string,
): TodayTrafficSample[] {
  return buildTodayTrafficMetricSamplesByUuid(series, [uuid])[uuid] ?? [];
}

const COUNTER_RESET_RATIO = 0.5;

function parseTimeMs(value: string | number): number {
  return parseTimestampMs(value) ?? Number.NaN;
}

function recordTimeMs(record: LoadRecord) {
  return parseTimeMs(record.time);
}

function advanceCounter(
  previous: number | null,
  current: number,
): { delta: number; next: number | null } {
  if (!Number.isFinite(current) || current < 0) {
    return { delta: 0, next: previous };
  }
  if (current === 0) {
    // 0 值帧（如 agent 重连/字段缺失）既不建立 0 基线也不覆盖正基线，
    // 避免下一帧恢复计数时把历史累计流量全量计为今日增量。
    return { delta: 0, next: previous };
  }
  if (previous == null) {
    return { delta: 0, next: current };
  }
  if (current >= previous) {
    return { delta: current - previous, next: current };
  }
  // 仅当计数显著回落（低于前值 50%）才视为真实重启归零；微小回落/抖动不计增量并保留高水位。
  if (current < previous * COUNTER_RESET_RATIO) {
    return { delta: current, next: current };
  }
  return { delta: 0, next: previous };
}

/** 单次排序同时产出累计统计与倒序速率明细，避免兼容回退路径对同一份 records 重复解析排序。 */
export function summarizeTodayTrafficRecordsWithSamples(
  uuid: string,
  records: LoadRecord[],
  startMs: number,
  endMs: number,
): { stat: TodayTrafficStat; samples: TodayTrafficSample[] } {
  const stat = emptyStat(uuid);
  const sorted = records
    .map((record) => ({ record, timeMs: recordTimeMs(record) }))
    .filter(({ timeMs }) => Number.isFinite(timeMs) && timeMs <= endMs)
    .sort((left, right) => left.timeMs - right.timeMs);

  const ascSamples: TodayTrafficSample[] = [];
  let previousUp: number | null = null;
  let previousDown: number | null = null;
  for (const item of sorted) {
    const { record, timeMs } = item;
    if (timeMs < startMs) {
      previousUp = advanceCounter(previousUp, record.net_total_up).next;
      previousDown = advanceCounter(previousDown, record.net_total_down).next;
      continue;
    }

    stat.hasSamples = true;
    stat.sampleCount += 1;
    const upStep = advanceCounter(previousUp, record.net_total_up);
    const downStep = advanceCounter(previousDown, record.net_total_down);
    stat.trafficUp += upStep.delta;
    stat.trafficDown += downStep.delta;
    previousUp = upStep.next;
    previousDown = downStep.next;

    const netOut = Math.max(0, Number.isFinite(record.net_out) ? record.net_out : 0);
    const netIn = Math.max(0, Number.isFinite(record.net_in) ? record.net_in : 0);
    ascSamples.push({ timeMs, up: netOut, down: netIn });
    if (netOut > stat.peakUp) {
      stat.peakUp = netOut;
      stat.peakUpAt = timeMs;
    }
    if (netIn > stat.peakDown) {
      stat.peakDown = netIn;
      stat.peakDownAt = timeMs;
    }
  }

  return { stat, samples: ascSamples.reverse() };
}

export function summarizeTodayTrafficRecords(
  uuid: string,
  records: LoadRecord[],
  startMs: number,
  endMs: number,
): TodayTrafficStat {
  return summarizeTodayTrafficRecordsWithSamples(uuid, records, startMs, endMs).stat;
}

export function buildTodayTrafficRecordSamples(
  records: LoadRecord[],
  startMs: number,
  endMs: number,
): TodayTrafficSample[] {
  return summarizeTodayTrafficRecordsWithSamples("", records, startMs, endMs).samples;
}
