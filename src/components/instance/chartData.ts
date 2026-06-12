export type TimedMetricPoint = {
  time: number;
  [key: string]: number | null;
};

// Upper bound on gap-marker (null) points inserted per detected gap, so a long
// outage can't inflate the aligned arrays into thousands of points.
const MAX_SENTINELS_PER_GAP = 6;

function hasPointNearTime(times: number[], target: number, tolerance: number) {
  let low = 0;
  let high = times.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const value = times[mid];
    if (Math.abs(value - target) <= tolerance) {
      return true;
    }
    if (value < target) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return false;
}

function median(values: number[]) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function normalizePoints(points: TimedMetricPoint[]) {
  if (points.length === 0) {
    return { points: [] as TimedMetricPoint[], keys: [] as string[] };
  }

  const keys = Array.from(
    points.reduce((set, point) => {
      Object.keys(point).forEach((key) => {
        if (key !== "time") set.add(key);
      });
      return set;
    }, new Set<string>()),
  );

  const base = Object.fromEntries(keys.map((key) => [key, null] as const));
  const deduped = new Map<number, TimedMetricPoint>();

  for (const point of [...points].sort((a, b) => a.time - b.time)) {
    deduped.set(point.time, {
      ...base,
      ...point,
    });
  }

  return {
    points: [...deduped.values()].sort((a, b) => a.time - b.time),
    keys,
  };
}

export function detectTypicalIntervalMs(
  times: number[],
  fallbackMs = 60,
) {
  if (times.length < 2) return fallbackMs;
  const unique = Array.from(new Set(times)).sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let index = 1; index < unique.length; index += 1) {
    const gap = unique[index] - unique[index - 1];
    if (gap > 0) gaps.push(gap);
  }
  return gaps.length > 0 ? median(gaps) : fallbackMs;
}

export function fillMissingMetricPoints(
  points: TimedMetricPoint[],
  options?: {
    intervalMs?: number;
    matchToleranceMs?: number;
  },
) {
  const normalized = normalizePoints(points);
  if (normalized.points.length < 2) return normalized.points;

  const { points: sortedPoints, keys } = normalized;
  const intervalMs =
    options?.intervalMs ?? detectTypicalIntervalMs(sortedPoints.map((point) => point.time));
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    return sortedPoints;
  }

  const matchToleranceMs = options?.matchToleranceMs ?? intervalMs / 2;
  const base = Object.fromEntries(keys.map((key) => [key, null] as const));
  const filled: TimedMetricPoint[] = [];
  const start = sortedPoints[0].time;
  const end = sortedPoints[sortedPoints.length - 1].time;
  let pointer = 0;

  for (let current = start; current <= end; current += intervalMs) {
    while (
      pointer < sortedPoints.length &&
      sortedPoints[pointer].time < current - matchToleranceMs
    ) {
      pointer += 1;
    }

    const matched =
      pointer < sortedPoints.length &&
      Math.abs(sortedPoints[pointer].time - current) <= matchToleranceMs
        ? sortedPoints[pointer]
        : null;

    filled.push(
      matched
        ? { ...base, ...matched, time: current }
        : { ...base, time: current },
    );

    if (matched) {
      pointer += 1;
    }
  }

  return filled;
}

export function insertMetricGapSentinels(
  points: TimedMetricPoint[],
  options?: {
    intervals?: Map<string, number>;
    defaultInterval?: number;
    matchToleranceRatio?: number;
  },
) {
  const normalized = normalizePoints(points);
  if (normalized.points.length < 2 || normalized.keys.length === 0) {
    return normalized.points;
  }

  const { points: sortedPoints, keys } = normalized;
  const existingTimes = sortedPoints.map((point) => point.time);
  const intervals = options?.intervals ?? new Map<string, number>();
  const defaultInterval =
    options?.defaultInterval ?? detectTypicalIntervalMs(existingTimes);
  const toleranceRatio = options?.matchToleranceRatio ?? 0.25;
  const sentinels = new Map<number, TimedMetricPoint>();

  for (const key of keys) {
    const validTimes = sortedPoints
      .filter((point) => typeof point[key] === "number" && Number.isFinite(point[key]))
      .map((point) => point.time);
    if (validTimes.length < 2) continue;

    const configuredInterval = intervals.get(key);
    const interval =
      typeof configuredInterval === "number" && configuredInterval > 0
        ? configuredInterval
        : detectTypicalIntervalMs(validTimes, defaultInterval);
    if (!Number.isFinite(interval) || interval <= 0) continue;

    const tolerance = Math.max(1, interval * toleranceRatio);
    for (let index = 1; index < validTimes.length; index += 1) {
      const previous = validTimes[index - 1];
      const current = validTimes[index];
      if (current - previous <= interval + tolerance) continue;

      // A single null between two points is enough to break the line, and uPlot
      // positions samples by timestamp so the gap width is unaffected by the
      // sentinel count. Cap per gap so a long outage (e.g. days at a 60s interval)
      // can't generate thousands of points and balloon render cost.
      let added = 0;
      for (
        let expected = previous + interval;
        expected < current - tolerance && added < MAX_SENTINELS_PER_GAP;
        expected += interval
      ) {
        if (hasPointNearTime(existingTimes, expected, tolerance) || sentinels.has(expected)) {
          continue;
        }
        sentinels.set(expected, { time: expected });
        added += 1;
      }
    }
  }

  if (sentinels.size === 0) {
    return sortedPoints;
  }

  return normalizePoints([...sortedPoints, ...sentinels.values()]).points;
}

export function interpolateMetricGaps(
  points: TimedMetricPoint[],
  keys: string[],
  options?: {
    maxGapMs?: number;
    maxGapMultiplier?: number;
    minCapMs?: number;
    maxCapMs?: number;
  },
) {
  if (points.length < 3 || keys.length === 0) return points;

  const out = points.map((point) => ({ ...point }));
  const times = out.map((point) => point.time);
  const multiplier = options?.maxGapMultiplier ?? 6;
  const minCapMs = options?.minCapMs ?? 120;
  const maxCapMs = options?.maxCapMs ?? 1_800;
  const clamp = (value: number, min: number, max: number) =>
    Math.max(min, Math.min(max, value));

  for (const key of keys) {
    const validIndices: number[] = [];
    for (let index = 0; index < out.length; index += 1) {
      const value = out[index][key];
      if (typeof value === "number" && Number.isFinite(value)) {
        validIndices.push(index);
      }
    }
    if (validIndices.length < 2) continue;

    let maxGapMs = options?.maxGapMs;
    if (maxGapMs == null) {
      const gaps: number[] = [];
      for (let index = 1; index < validIndices.length; index += 1) {
        const gap = times[validIndices[index]] - times[validIndices[index - 1]];
        if (gap > 0) gaps.push(gap);
      }
      if (gaps.length === 0) continue;
      maxGapMs = clamp(median(gaps) * multiplier, minCapMs, maxCapMs);
    }

    for (let index = 0; index < validIndices.length - 1; index += 1) {
      const startIndex = validIndices[index];
      const endIndex = validIndices[index + 1];
      if (endIndex - startIndex <= 1) continue;

      const startTime = times[startIndex];
      const endTime = times[endIndex];
      const totalGap = endTime - startTime;
      if (!Number.isFinite(totalGap) || totalGap <= 0 || totalGap > maxGapMs) {
        continue;
      }

      const startValue = out[startIndex][key] as number;
      const endValue = out[endIndex][key] as number;
      for (let gapIndex = startIndex + 1; gapIndex < endIndex; gapIndex += 1) {
        const ratio = (times[gapIndex] - startTime) / totalGap;
        out[gapIndex][key] = startValue + (endValue - startValue) * ratio;
      }
    }
  }

  return out;
}

export function cutPeakValues<T extends { [key: string]: any }>(
  data: T[],
  keys: string[],
  alpha = 0.1,
  windowSize = 15,
  spikeThreshold = 0.3,
) {
  if (!data || data.length === 0 || keys.length === 0) return data;

  const result = data.map((point) => ({ ...point }));
  const halfWindow = Math.floor(windowSize / 2);

  for (const key of keys) {
    // Remember which points had no value to begin with (packet loss / gaps).
    // The EWMA pass below must NOT backfill these — only the spikes it removes —
    // otherwise a loss gap renders as fabricated latency.
    const originallyMissing = new Set<number>();
    for (let index = 0; index < result.length; index += 1) {
      const value = result[index][key];
      if (value == null || typeof value !== "number" || !Number.isFinite(value)) {
        originallyMissing.add(index);
      }
    }

    for (let index = 0; index < result.length; index += 1) {
      const currentValue = result[index][key];
      if (currentValue == null || typeof currentValue !== "number") continue;

      const neighbors: number[] = [];
      for (
        let pointer = Math.max(0, index - halfWindow);
        pointer <= Math.min(result.length - 1, index + halfWindow);
        pointer += 1
      ) {
        if (pointer === index) continue;
        const neighbor = result[pointer][key];
        if (neighbor != null && typeof neighbor === "number" && Number.isFinite(neighbor)) {
          neighbors.push(neighbor);
        }
      }

      if (neighbors.length < 2) continue;

      const mean = neighbors.reduce((sum, value) => sum + value, 0) / neighbors.length;
      if (mean > 0) {
        const relativeChange = Math.abs(currentValue - mean) / mean;
        if (relativeChange > spikeThreshold) {
          result[index] = {
            ...result[index],
            [key]: null,
          };
        }
      } else if (Math.abs(currentValue) > 10) {
        result[index] = {
          ...result[index],
          [key]: null,
        };
      }
    }

    let ewma: number | null = null;
    for (let index = 0; index < result.length; index += 1) {
      const currentValue = result[index][key];
      if (currentValue != null && typeof currentValue === "number" && Number.isFinite(currentValue)) {
        ewma = ewma == null ? currentValue : alpha * currentValue + (1 - alpha) * ewma;
        result[index] = {
          ...result[index],
          [key]: ewma,
        };
      } else if (ewma != null && !originallyMissing.has(index)) {
        // Smooth over a spike we just removed, but leave genuine loss gaps null.
        result[index] = {
          ...result[index],
          [key]: ewma,
        };
      }
    }
  }

  return result;
}
