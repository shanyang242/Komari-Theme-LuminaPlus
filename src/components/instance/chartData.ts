export type TimedMetricPoint = {
  time: number;
  // null = 真实断点 (丢包或检测到的中断)——切断线条。
  // undefined = 该 task 在这个对齐 anchor 上根本没有采样 (anchor 是另一个 task 建的)——
  // 须跨过、不当作断点。区分这两者，uPlot 才能跨越 off-phase 列画连续线，同时在真实空缺处断开。
  [key: string]: number | null | undefined;
};

// 每个检测到的 gap 最多插入的 null 标记点数上限，避免长时间中断把对齐数组撑成上千个点。
const MAX_SENTINELS_PER_GAP = 6;

// 空缺超过「桥接阈值」才算真实中断、插 null 断点；更小的空缺留给 uPlot 跨过，避免漏采把线切碎。
// 阈值：周期 × 6，再钳到 [2min, 30min]。
const GAP_BREAK_INTERVAL_MULTIPLIER = 6;
const GAP_BREAK_MIN_SECONDS = 120; // 下限 2min：短周期任务偶尔抖动不至于一漏就断
const GAP_BREAK_MAX_SECONDS = 1800; // 上限 30min：再长的洞一定断，不画跨越超长空缺的假线

// 在升序 `times` 上二分查找与 `target` 相差在 `tolerance` 内的下标，没有则返回 -1。
// 用于把断点 null 合并到已有的他 task anchor 上，而不是新建一个近重复列。
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

function median(values: number[]) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

// `spanMissing` 决定缺失的 task key 填成什么。false (默认) 填 `null`——把缺采样当真实断点，
// 适用于 LoadChart 的 fillMissingMetricPoints 这类单序列填充。true 填 `undefined`，让 off-phase
// anchor (另一个 task 建的列) 保持可跨越而非切断每条线。(用布尔而非填充值，因为给有默认值的参数
// 传 `undefined` 只会再次触发默认值。)
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

  // 对同一时间戳的点做合并 (而非覆盖)，这样落在已有 anchor 上的某 task 哨兵 null
  // 不会丢掉该 anchor 上其他 task 的值。
  for (const point of [...points].sort((a, b) => a.time - b.time)) {
    const prev = deduped.get(point.time);
    deduped.set(point.time, prev ? { ...prev, ...point } : { ...base, ...point });
  }

  return {
    points: [...deduped.values()].sort((a, b) => a.time - b.time),
    keys,
  };
}

export function detectTypicalIntervalSeconds(
  times: number[],
  fallbackSeconds = 60,
) {
  if (times.length < 2) return fallbackSeconds;
  const unique = Array.from(new Set(times)).sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let index = 1; index < unique.length; index += 1) {
    const gap = unique[index] - unique[index - 1];
    if (gap > 0) gaps.push(gap);
  }
  return gaps.length > 0 ? median(gaps) : fallbackSeconds;
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
  const start = sortedPoints[0].time;
  const end = sortedPoints[sortedPoints.length - 1].time;
  let pointer = 0;

  for (let current = start; current <= end; current += intervalSeconds) {
    while (
      pointer < sortedPoints.length &&
      sortedPoints[pointer].time < current - matchToleranceSeconds
    ) {
      pointer += 1;
    }

    const matched =
      pointer < sortedPoints.length &&
      Math.abs(sortedPoints[pointer].time - current) <= matchToleranceSeconds
        ? sortedPoints[pointer]
        : null;

    // 内部采样吸附到网格时间，但保留最新采样自己的时间戳——否则不在网格上的末点会被前移
    // 半个 interval，导致图表右边缘和覆盖范围标签都偏移。
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

      // 一个 null 就足以断线。把当前 task 在 gap 内标为断开：若此处已有别的 task 的 anchor，
      // 就把 null 设到它上面 (不新建近重复列)；否则加一个本 task 的哨兵——合并而非覆盖，这样多个
      // task 同时中断也都能保留。每个 gap 有上限，避免长时间中断把点数撑爆。
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

    let maxGapSeconds = options?.maxGapSeconds;
    if (maxGapSeconds == null) {
      const gaps: number[] = [];
      for (let index = 1; index < validIndices.length; index += 1) {
        const gap = times[validIndices[index]] - times[validIndices[index - 1]];
        if (gap > 0) gaps.push(gap);
      }
      if (gaps.length === 0) continue;
      maxGapSeconds = clamp(median(gaps) * multiplier, minCapSeconds, maxCapSeconds);
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
    // 记下哪些点本来就没值 (丢包/空缺)。下面的 EWMA 过程绝不能回填这些点——只能补它自己
    // 移除的尖峰——否则丢包空缺会被渲染成假的延迟。
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
        // 平滑掉刚移除的尖峰，但真实丢包空缺保持 null。
        result[index] = {
          ...result[index],
          [key]: ewma,
        };
      }
    }
  }

  return result;
}

// 桶内偏离均值超过这个相对比例才判定为「真尖峰」，保峰模式下输出极值而非均值。
// 调小 → 更多波动被保留（线更跳）；调大 → 只有非常突出的尖峰才显出来。
const PEAK_PRESERVE_SPIKE_RATIO = 0.3;

// 按时间等宽分桶降采样：降到 uPlot 抽稀阈值以下避免尖刺。
// 三态保留：任何 null→null（断点优先，避免丢包被均值吞掉），有值→见下，全 off-phase→undefined。
// preservePeaks=false（默认）：桶内取均值——平滑，但单点尖峰会被均值吞掉。
// preservePeaks=true：平坦桶仍取均值（基线干净），但桶内极值偏离均值超过 PEAK_PRESERVE_SPIKE_RATIO
//   时输出该极值——让真实尖峰/突降穿透降采样显示出来（配合关闭额外滑动平均使用）。
export function downsampleAligned(
  times: number[],
  perTask: Array<Array<number | null | undefined>>,
  maxPoints: number,
  preservePeaks = false,
): { times: number[]; perTask: Array<Array<number | null | undefined>> } {
  const length = times.length;
  if (length <= maxPoints || maxPoints <= 0) return { times, perTask };

  const min = times[0];
  const max = times[length - 1];
  const span = max - min;
  if (!(span > 0)) return { times, perTask };
  const bucketDuration = span / maxPoints;

  const seriesCount = perTask.length;
  const timeSum = new Array<number>(maxPoints).fill(0);
  const timeCount = new Array<number>(maxPoints).fill(0);
  const valueSum = perTask.map(() => new Array<number>(maxPoints).fill(0));
  const valueCount = perTask.map(() => new Array<number>(maxPoints).fill(0));
  const nullCount = perTask.map(() => new Array<number>(maxPoints).fill(0));
  // 仅保峰模式需要：记录每桶每序列的最大/最小值，用来判断并输出尖峰极值。
  const valueMax = preservePeaks
    ? perTask.map(() => new Array<number>(maxPoints).fill(Number.NEGATIVE_INFINITY))
    : null;
  const valueMin = preservePeaks
    ? perTask.map(() => new Array<number>(maxPoints).fill(Number.POSITIVE_INFINITY))
    : null;

  for (let i = 0; i < length; i += 1) {
    let bucket = Math.floor((times[i] - min) / bucketDuration);
    if (bucket < 0) bucket = 0;
    else if (bucket >= maxPoints) bucket = maxPoints - 1;
    timeSum[bucket] += times[i];
    timeCount[bucket] += 1;
    for (let s = 0; s < seriesCount; s += 1) {
      const value = perTask[s][i];
      if (typeof value === "number" && Number.isFinite(value)) {
        valueSum[s][bucket] += value;
        valueCount[s][bucket] += 1;
        if (valueMax && value > valueMax[s][bucket]) valueMax[s][bucket] = value;
        if (valueMin && value < valueMin[s][bucket]) valueMin[s][bucket] = value;
      } else if (value === null) {
        nullCount[s][bucket] += 1;
      }
    }
  }

  const outTimes: number[] = [];
  const outPerTask: Array<Array<number | null | undefined>> = perTask.map(() => []);
  for (let bucket = 0; bucket < maxPoints; bucket += 1) {
    if (timeCount[bucket] === 0) continue; // 跳过没有任何样本的空桶
    outTimes.push(timeSum[bucket] / timeCount[bucket]);
    for (let s = 0; s < seriesCount; s += 1) {
      if (nullCount[s][bucket] > 0) {
        outPerTask[s].push(null); // 断点优先：桶内有丢包就断开
        continue;
      }
      if (valueCount[s][bucket] === 0) {
        outPerTask[s].push(undefined); // 全 off-phase：跨过、不当断点
        continue;
      }
      const mean = valueSum[s][bucket] / valueCount[s][bucket];
      if (!preservePeaks || !valueMax || !valueMin) {
        outPerTask[s].push(mean);
        continue;
      }
      // 保峰：取偏离均值更大的一侧极值；只有偏离超过阈值才用极值，否则保持均值基线干净。
      const upDev = valueMax[s][bucket] - mean;
      const downDev = mean - valueMin[s][bucket];
      const extreme = upDev >= downDev ? valueMax[s][bucket] : valueMin[s][bucket];
      const extDev = Math.max(upDev, downDev);
      const isSpike = mean > 0 && extDev > mean * PEAK_PRESERVE_SPIKE_RATIO;
      outPerTask[s].push(isSpike ? extreme : mean);
    }
  }

  return { times: outTimes, perTask: outPerTask };
}

// 按点数的滑动平均：每个数值点取前后各 floor(window/2) 个点取均值。降采样后各时段点数一致，
// 用固定点窗能让 1h/4h/1d 获得一致的平滑度（按时间窗会因每点时间跨度不同而力度不均）。
// null/undefined（断点/off-phase）原样保留。
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
