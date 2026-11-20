import { clamp } from "@/utils/hsl";
import { inferMedianIntervalSeconds, medianValue } from "@/utils/historyRange";

export type TimedMetricPoint = {
  time: number;
  // null=真实断点（断线），undefined=错相未采（uPlot 跨过）
  [key: string]: number | null | undefined;
};

const MAX_SENTINELS_PER_GAP = 6;
// 断线阈值：周期 × 6，钳制在 [2min, 30min]
const GAP_BREAK_INTERVAL_MULTIPLIER = 6;
const GAP_BREAK_MIN_SECONDS = 120;
const GAP_BREAK_MAX_SECONDS = 1800;

function findPointNearTime(times: number[], target: number, tolerance: number) {
  let low = 0;
  let high = times.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const value = times[mid];
    if (Math.abs(value - target) <= tolerance) {
      return mid;
    }
    if (value < target) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return -1;
}

// spanMissing: true 填 undefined（跨过错相列），false 填 null（断线）
function normalizePoints(points: TimedMetricPoint[], spanMissing = false) {
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

  const fillValue = spanMissing ? undefined : null;
  const base = Object.fromEntries(keys.map((key) => [key, fillValue] as const));
  const deduped = new Map<number, TimedMetricPoint>();

  // 同时间戳合并而非覆盖，保留其他 task 的值
  for (const point of [...points].sort((a, b) => a.time - b.time)) {
    const prev = deduped.get(point.time);
    deduped.set(point.time, prev ? { ...prev, ...point } : { ...base, ...point });
  }

  return {
    points: Array.from(deduped.values()),
    keys,
  };
}

export function detectTypicalIntervalSeconds(
  times: number[],
  fallbackSeconds = 60,
) {
  if (times.length < 2) return fallbackSeconds;
  return inferMedianIntervalSeconds(times) ?? fallbackSeconds;
}

function isSeparatedAscending<T extends { time: number }>(points: readonly T[]): boolean {
  for (let index = 1; index < points.length; index += 1) {
    if (points[index].time - points[index - 1].time < 1) return false;
  }
  return true;
}

/** 合并历史与实时点：有序无交错时直接拼接，否则排序并按 1s 去重。 */
export function mergeRealtimeMetricPoints<T extends { time: number }>(
  initial: readonly T[],
  realtimePoints: readonly T[],
  limit: number,
): T[] {
  const canAppendDirectly =
    isSeparatedAscending(initial) &&
    isSeparatedAscending(realtimePoints) &&
    (initial.length === 0 ||
      realtimePoints.length === 0 ||
      realtimePoints[0].time - initial[initial.length - 1].time >= 1);

  if (canAppendDirectly) {
    if (realtimePoints.length === 0) return initial.slice(-limit);
    if (initial.length === 0) return realtimePoints.slice(-limit);
    return [...initial, ...realtimePoints].slice(-limit);
  }

  const merged = [...initial, ...realtimePoints].sort((a, b) => a.time - b.time);
  const deduped = merged.filter((point, index, arr) => {
    const next = arr[index + 1];
    return !next || Math.abs(next.time - point.time) >= 1;
  });
  return deduped.slice(-limit);
}

export function fillMissingMetricPoints(
  points: TimedMetricPoint[],
  options?: {
    intervalSeconds?: number;
    matchToleranceSeconds?: number;
  },
) {
  const normalized = normalizePoints(points);
  if (normalized.points.length < 2) return normalized.points;

  const { points: sortedPoints, keys } = normalized;
  const intervalSeconds =
    options?.intervalSeconds ?? detectTypicalIntervalSeconds(sortedPoints.map((point) => point.time));
  if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0) {
    return sortedPoints;
  }

  const matchToleranceSeconds = options?.matchToleranceSeconds ?? intervalSeconds / 2;
  const base = Object.fromEntries(keys.map((key) => [key, null] as const));
  const filled: TimedMetricPoint[] = [];
  const appendUnmatched = (point: TimedMetricPoint) => {
    const previous = filled[filled.length - 1];
    if (!previous || point.time > previous.time) {
      filled.push({ ...base, ...point });
    } else if (point.time === previous.time) {
      filled[filled.length - 1] = { ...previous, ...point };
    }
  };
  const start = sortedPoints[0].time;
  const end = sortedPoints[sortedPoints.length - 1].time;
  let pointer = 0;

  for (let current = start; current <= end; current += intervalSeconds) {
    while (
      pointer < sortedPoints.length &&
      sortedPoints[pointer].time < current - matchToleranceSeconds
    ) {
      appendUnmatched(sortedPoints[pointer]);
      pointer += 1;
    }

    const matched =
      pointer < sortedPoints.length &&
      Math.abs(sortedPoints[pointer].time - current) <= matchToleranceSeconds
        ? sortedPoints[pointer]
        : null;

    // 末点保留原始时间戳，避免右边缘与覆盖范围偏移
    const isLastSample = matched === sortedPoints[sortedPoints.length - 1];
    filled.push(
      matched
        ? { ...base, ...matched, time: isLastSample ? matched.time : current }
        : { ...base, time: current },
    );

    if (matched) {
      pointer += 1;
    }
  }

  while (pointer < sortedPoints.length) {
    appendUnmatched(sortedPoints[pointer]);
    pointer += 1;
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
  const normalized = normalizePoints(points, true);
  if (normalized.points.length < 2 || normalized.keys.length === 0) {
    return normalized.points;
  }

  const { points: sortedPoints, keys } = normalized;
  const existingTimes = sortedPoints.map((point) => point.time);
  const intervals = options?.intervals ?? new Map<string, number>();
  const defaultInterval =
    options?.defaultInterval ?? detectTypicalIntervalSeconds(existingTimes);
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
        : detectTypicalIntervalSeconds(validTimes, defaultInterval);
    if (!Number.isFinite(interval) || interval <= 0) continue;

    const tolerance = Math.max(1, interval * toleranceRatio);
    const breakThreshold = Math.min(
      GAP_BREAK_MAX_SECONDS,
      Math.max(GAP_BREAK_MIN_SECONDS, interval * GAP_BREAK_INTERVAL_MULTIPLIER),
    );
    for (let index = 1; index < validTimes.length; index += 1) {
      const previous = validTimes[index - 1];
      const current = validTimes[index];
      if (current - previous <= breakThreshold) continue;

      // 优先复用已有 anchor 写入 null，否则新增合并哨兵
      let added = 0;
      for (
        let expected = previous + interval;
        expected < current - tolerance && added < MAX_SENTINELS_PER_GAP;
        expected += interval
      ) {
        const nearIdx = findPointNearTime(existingTimes, expected, tolerance);
        if (nearIdx >= 0) {
          sortedPoints[nearIdx][key] = null;
        } else {
          const sentinel = sentinels.get(expected) ?? { time: expected };
          sentinel[key] = null;
          sentinels.set(expected, sentinel);
        }
        added += 1;
      }
    }
  }

  if (sentinels.size === 0) {
    return sortedPoints;
  }

  return normalizePoints([...sortedPoints, ...sentinels.values()], true).points;
}

export function interpolateMetricGaps(
  points: TimedMetricPoint[],
  keys: string[],
  options?: {
    maxGapSeconds?: number;
    maxGapMultiplier?: number;
    minCapSeconds?: number;
    maxCapSeconds?: number;
  },
) {
  if (points.length < 3 || keys.length === 0) return points;

  const out = points.map((point) => ({ ...point }));
  const times = out.map((point) => point.time);
  const multiplier = options?.maxGapMultiplier ?? 6;
  const minCapSeconds = options?.minCapSeconds ?? 120;
  const maxCapSeconds = options?.maxCapSeconds ?? 1_800;

  for (const key of keys) {
    const validIndices: number[] = [];
    for (let index = 0; index < out.length; index += 1) {
      const value = out[index][key];
      if (typeof value === "number" && Number.isFinite(value)) {
        validIndices.push(index);
      }
    }
    if (validIndices.length < 2) continue;

    let maxGapSeconds = options?.maxGapSeconds;
    if (maxGapSeconds == null) {
      const gaps: number[] = [];
      for (let index = 1; index < validIndices.length; index += 1) {
        const gap = times[validIndices[index]] - times[validIndices[index - 1]];
        if (gap > 0) gaps.push(gap);
      }
      if (gaps.length === 0) continue;
      maxGapSeconds = clamp((medianValue(gaps) ?? 0) * multiplier, minCapSeconds, maxCapSeconds);
    }

    for (let index = 0; index < validIndices.length - 1; index += 1) {
      const startIndex = validIndices[index];
      const endIndex = validIndices[index + 1];
      if (endIndex - startIndex <= 1) continue;

      const startTime = times[startIndex];
      const endTime = times[endIndex];
      const totalGap = endTime - startTime;
      if (!Number.isFinite(totalGap) || totalGap <= 0 || totalGap > maxGapSeconds) {
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

export function cutPeakValues<T extends { [key: string]: number | null | undefined }>(
  data: T[],
  keys: string[],
  alpha = 0.1,
  windowSize = 15,
  spikeThreshold = 0.3,
) {
  if (!data || data.length === 0 || keys.length === 0) return data;

  const result = data.map((point) => ({ ...point })) as Array<Record<string, number | null | undefined>>;
  const halfWindow = Math.floor(windowSize / 2);

  for (const key of keys) {
    // 记录原始空缺，EWMA 仅回填被削尖峰，不回填丢包
    const originallyMissing = new Uint8Array(result.length);
    for (let index = 0; index < result.length; index += 1) {
      const value = result[index][key];
      if (value == null || typeof value !== "number" || !Number.isFinite(value)) {
        originallyMissing[index] = 1;
      }
    }

    for (let index = 0; index < result.length; index += 1) {
      const currentValue = result[index][key];
      if (currentValue == null || typeof currentValue !== "number") continue;

      let neighborSum = 0;
      let neighborCount = 0;
      const start = Math.max(0, index - halfWindow);
      const end = Math.min(result.length - 1, index + halfWindow);
      for (let pointer = start; pointer <= end; pointer += 1) {
        if (pointer === index) continue;
        const neighbor = result[pointer][key];
        if (neighbor != null && typeof neighbor === "number" && Number.isFinite(neighbor)) {
          neighborSum += neighbor;
          neighborCount += 1;
        }
      }

      if (neighborCount < 2) continue;

      const mean = neighborSum / neighborCount;
      if (mean > 0) {
        if (Math.abs(currentValue - mean) / mean > spikeThreshold) {
          result[index][key] = null;
        }
      } else if (Math.abs(currentValue) > 10) {
        result[index][key] = null;
      }
    }

    let ewma: number | null = null;
    for (let index = 0; index < result.length; index += 1) {
      const currentValue = result[index][key];
      if (currentValue != null && typeof currentValue === "number" && Number.isFinite(currentValue)) {
        ewma = ewma == null ? currentValue : alpha * currentValue + (1 - alpha) * ewma;
        result[index][key] = ewma;
      } else if (ewma != null && originallyMissing[index] === 0) {
        result[index][key] = ewma;
      }
    }
  }

  return result as T[];
}

// 保峰模式下偏离均值超过此比例视为尖峰
const PEAK_PRESERVE_SPIKE_RATIO = 0.3;

interface AlignedBucketReducer {
  addValue: (seriesIndex: number, bucket: number, pointIndex: number, value: number) => void;
  getValue: (seriesIndex: number, bucket: number) => number | undefined;
}

function downsampleAlignedWith(
  times: number[],
  perTask: Array<Array<number | null | undefined>>,
  maxPoints: number,
  createReducer: (seriesCount: number, bucketCount: number) => AlignedBucketReducer,
  nullBucketMode: "any" | "all",
): { times: number[]; perTask: Array<Array<number | null | undefined>> } {
  const length = times.length;
  if (length <= maxPoints || maxPoints <= 0) return { times, perTask };

  const min = times[0];
  const max = times[length - 1];
  const span = max - min;
  if (!(span > 0)) return { times, perTask };
  const bucketDuration = span / maxPoints;

  const seriesCount = perTask.length;
  const reducer = createReducer(seriesCount, maxPoints);
  const timeSum = new Array<number>(maxPoints).fill(0);
  const timeCount = new Array<number>(maxPoints).fill(0);
  const nullCount = perTask.map(() => new Array<number>(maxPoints).fill(0));

  for (let pointIndex = 0; pointIndex < length; pointIndex += 1) {
    let bucket = Math.floor((times[pointIndex] - min) / bucketDuration);
    if (bucket < 0) bucket = 0;
    else if (bucket >= maxPoints) bucket = maxPoints - 1;
    timeSum[bucket] += times[pointIndex];
    timeCount[bucket] += 1;

    for (let seriesIndex = 0; seriesIndex < seriesCount; seriesIndex += 1) {
      const value = perTask[seriesIndex]?.[pointIndex];
      if (value === null) {
        nullCount[seriesIndex][bucket] += 1;
      } else if (typeof value === "number" && Number.isFinite(value)) {
        reducer.addValue(seriesIndex, bucket, pointIndex, value);
      }
    }
  }

  const outTimes: number[] = [];
  const outPerTask: Array<Array<number | null | undefined>> = perTask.map(() => []);
  for (let bucket = 0; bucket < maxPoints; bucket += 1) {
    if (timeCount[bucket] === 0) continue;
    outTimes.push(timeSum[bucket] / timeCount[bucket]);
    for (let seriesIndex = 0; seriesIndex < seriesCount; seriesIndex += 1) {
      const value = reducer.getValue(seriesIndex, bucket);
      outPerTask[seriesIndex].push(
        nullCount[seriesIndex][bucket] > 0 &&
        (nullBucketMode === "any" || value === undefined)
          ? null
          : value,
      );
    }
  }

  return { times: outTimes, perTask: outPerTask };
}

/** 等宽时间分桶降采样；preservePeaks 保留超阈值极值，nullBucketMode="all" 仅整桶无值时断开。 */
export function downsampleAligned(
  times: number[],
  perTask: Array<Array<number | null | undefined>>,
  maxPoints: number,
  preservePeaks = false,
  nullBucketMode: "any" | "all" = "any",
): { times: number[]; perTask: Array<Array<number | null | undefined>> } {
  return downsampleAlignedWith(times, perTask, maxPoints, (seriesCount, bucketCount) => {
    const valueSum = Array.from({ length: seriesCount }, () =>
      new Array<number>(bucketCount).fill(0),
    );
    const valueCount = Array.from({ length: seriesCount }, () =>
      new Array<number>(bucketCount).fill(0),
    );
    const valueMax = preservePeaks
      ? Array.from({ length: seriesCount }, () =>
          new Array<number>(bucketCount).fill(Number.NEGATIVE_INFINITY),
        )
      : null;
    const valueMin = preservePeaks
      ? Array.from({ length: seriesCount }, () =>
          new Array<number>(bucketCount).fill(Number.POSITIVE_INFINITY),
        )
      : null;

    return {
      addValue(seriesIndex, bucket, _pointIndex, value) {
        valueSum[seriesIndex][bucket] += value;
        valueCount[seriesIndex][bucket] += 1;
        if (valueMax && value > valueMax[seriesIndex][bucket]) {
          valueMax[seriesIndex][bucket] = value;
        }
        if (valueMin && value < valueMin[seriesIndex][bucket]) {
          valueMin[seriesIndex][bucket] = value;
        }
      },
      getValue(seriesIndex, bucket) {
        const count = valueCount[seriesIndex][bucket];
        if (count === 0) return undefined;
        const mean = valueSum[seriesIndex][bucket] / count;
        if (!preservePeaks || !valueMax || !valueMin) return mean;

        const upDev = valueMax[seriesIndex][bucket] - mean;
        const downDev = mean - valueMin[seriesIndex][bucket];
        const extreme =
          upDev >= downDev ? valueMax[seriesIndex][bucket] : valueMin[seriesIndex][bucket];
        const extDev = Math.max(upDev, downDev);
        return mean > 0 && extDev > mean * PEAK_PRESERVE_SPIKE_RATIO ? extreme : mean;
      },
    };
  }, nullBucketMode);
}

/** 固定点数滑动平均，保持各时段平滑度一致，保留 null/undefined。 */
export function smoothByCount(
  perTask: Array<Array<number | null | undefined>>,
  windowPoints: number,
): Array<Array<number | null | undefined>> {
  if (windowPoints <= 1) return perTask;
  const half = Math.floor(windowPoints / 2);
  return perTask.map((series) => {
    const out = series.slice();
    const n = series.length;
    for (let i = 0; i < n; i += 1) {
      const value = series[i];
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      const start = Math.max(0, i - half);
      const end = Math.min(n - 1, i + half);
      let sum = 0;
      let count = 0;
      for (let j = start; j <= end; j += 1) {
        const neighbor = series[j];
        if (typeof neighbor === "number" && Number.isFinite(neighbor)) {
          sum += neighbor;
          count += 1;
        }
      }
      if (count > 0) out[i] = sum / count;
    }
    return out;
  });
}
