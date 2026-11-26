const RAW_RETENTION_MS = 15 * 60 * 1000;
const COMPACTION_INTERVAL_MS = 5 * 60 * 1000;
const BOUNDARY_MARGIN_MS = 60 * 1000;

export interface MetricBoundaryPoint {
  time: string;
  value: number | null;
  count: number;
}

export interface MetricBoundarySeries {
  metricKey: string;
  client: string;
  tags?: Record<string, string>;
  intervalSeconds?: number;
  points: MetricBoundaryPoint[];
}

export interface MetricBoundaryRange {
  startMs: number;
  endMs: number;
}

export type MetricBoundaryAggregation = "avg" | "last" | "sum" | "max";

function seriesKey(series: MetricBoundarySeries) {
  const tags = Object.entries(series.tags ?? {}).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  return `${series.metricKey}\u0000${series.client}\u0000${JSON.stringify(tags)}`;
}

function pointTimeMs(point: MetricBoundaryPoint) {
  return Date.parse(point.time);
}

function isUsableAggregatePoint(point: MetricBoundaryPoint) {
  return point.count > 0 && point.value != null && Number.isFinite(point.value);
}

function overlapsRange(startMs: number, endMs: number, range: MetricBoundaryRange) {
  return startMs < range.endMs && endMs > range.startMs;
}

export function getMetricBoundaryRepairRange(
  rangeStartMs: number,
  rangeEndMs: number,
): MetricBoundaryRange | null {
  if (!Number.isFinite(rangeStartMs) || !Number.isFinite(rangeEndMs)) return null;
  const boundaryMs = rangeEndMs - RAW_RETENTION_MS;
  if (rangeStartMs >= boundaryMs) return null;

  const startMs = Math.max(rangeStartMs, boundaryMs - COMPACTION_INTERVAL_MS);
  const endMs = Math.min(rangeEndMs, boundaryMs + BOUNDARY_MARGIN_MS);
  return endMs > startMs ? { startMs, endMs } : null;
}

export function hasMetricBoundaryGap(
  series: MetricBoundarySeries[],
  range: MetricBoundaryRange,
) {
  for (const item of series) {
    const intervalMs = (item.intervalSeconds ?? 0) * 1000;
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) continue;

    const populatedTimes: number[] = [];
    for (const point of item.points) {
      const timeMs = pointTimeMs(point);
      if (!Number.isFinite(timeMs)) continue;
      if (isUsableAggregatePoint(point)) {
        populatedTimes.push(timeMs);
      } else if (overlapsRange(timeMs, timeMs + intervalMs, range)) {
        return true;
      }
    }

    populatedTimes.sort((left, right) => left - right);
    for (let index = 1; index < populatedTimes.length; index += 1) {
      const previous = populatedTimes[index - 1];
      const current = populatedTimes[index];
      if (
        current - previous > intervalMs * 1.5 &&
        overlapsRange(previous + intervalMs, current, range)
      ) {
        return true;
      }
    }
  }
  return false;
}

function aggregateRawPoints(
  points: MetricBoundaryPoint[],
  aggregation: MetricBoundaryAggregation,
): MetricBoundaryPoint | null {
  const valid = points
    .map((point) => ({ point, timeMs: pointTimeMs(point) }))
    .filter(
      ({ point, timeMs }) =>
        Number.isFinite(timeMs) && point.value != null && Number.isFinite(point.value),
    )
    .sort((left, right) => left.timeMs - right.timeMs);
  if (valid.length === 0) return null;

  const values = valid.map((item) => item.point.value ?? 0);
  // 旧后端的 raw 点可能不带 count，按单样本计；新后端的混合结果
  // 可包含 count > 1 的 rollup 点，必须保留真实样本数。
  const count = valid.reduce(
    (sum, item) => sum + (item.point.count > 0 ? item.point.count : 1),
    0,
  );
  const weightedValueSum = valid.reduce(
    (sum, item) =>
      sum +
      (item.point.value ?? 0) * (item.point.count > 0 ? item.point.count : 1),
    0,
  );
  const value =
    aggregation === "last"
      ? values[values.length - 1]
      : aggregation === "sum"
        ? values.reduce((sum, current) => sum + current, 0)
        : aggregation === "max"
          ? Math.max(...values)
          : weightedValueSum / count;
  return {
    time: valid[0].point.time,
    value,
    count,
  };
}

export function fillMetricBoundaryGaps<T extends MetricBoundarySeries>(
  aggregateSeries: T[],
  rawSeries: T[],
  aggregationByMetric: Partial<Record<string, MetricBoundaryAggregation>> = {},
) {
  const rawBySeries = new Map(rawSeries.map((item) => [seriesKey(item), item] as const));
  const output: T[] = [];
  const seen = new Set<string>();
  let repairedSamples = 0;

  const repairOne = (aggregate: T | undefined, raw: T) => {
    const intervalSeconds = aggregate?.intervalSeconds ?? raw.intervalSeconds ?? 0;
    const intervalMs = intervalSeconds * 1000;
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) return aggregate ?? raw;

    const points = [...(aggregate?.points ?? [])];
    const pointIndexByBucket = new Map<number, number>();
    for (let index = 0; index < points.length; index += 1) {
      const timeMs = pointTimeMs(points[index]);
      if (Number.isFinite(timeMs)) {
        pointIndexByBucket.set(Math.floor(timeMs / intervalMs) * intervalMs, index);
      }
    }

    const rawBuckets = new Map<number, MetricBoundaryPoint[]>();
    for (const point of raw.points) {
      const timeMs = pointTimeMs(point);
      if (!Number.isFinite(timeMs)) continue;
      const bucketMs = Math.floor(timeMs / intervalMs) * intervalMs;
      const current = rawBuckets.get(bucketMs);
      if (current) current.push(point);
      else rawBuckets.set(bucketMs, [point]);
    }

    for (const [bucketMs, rawPoints] of rawBuckets) {
      const existingIndex = pointIndexByBucket.get(bucketMs);
      const existing = existingIndex == null ? undefined : points[existingIndex];
      if (existing && isUsableAggregatePoint(existing)) continue;

      const repaired = aggregateRawPoints(
        rawPoints,
        aggregationByMetric[raw.metricKey] ?? "avg",
      );
      if (!repaired) continue;

      const replacement = {
        ...repaired,
        time: existing?.time ?? new Date(bucketMs).toISOString(),
      };
      if (existingIndex == null) points.push(replacement);
      else points[existingIndex] = replacement;
      repairedSamples += repaired.count;
    }

    const orderedPoints = points
      .map((point) => ({ point, timeMs: pointTimeMs(point) }))
      .sort((left, right) => {
        const leftTime = Number.isFinite(left.timeMs) ? left.timeMs : Number.POSITIVE_INFINITY;
        const rightTime = Number.isFinite(right.timeMs) ? right.timeMs : Number.POSITIVE_INFINITY;
        return leftTime - rightTime;
      })
      .map(({ point }) => point);
    return {
      ...(aggregate ?? raw),
      intervalSeconds,
      points: orderedPoints,
    } as T;
  };

  for (const aggregate of aggregateSeries) {
    const key = seriesKey(aggregate);
    const raw = rawBySeries.get(key);
    seen.add(key);
    output.push(raw ? repairOne(aggregate, raw) : aggregate);
  }
  for (const raw of rawSeries) {
    const key = seriesKey(raw);
    if (!seen.has(key)) output.push(repairOne(undefined, raw));
  }

  return { series: output, repairedSamples };
}
