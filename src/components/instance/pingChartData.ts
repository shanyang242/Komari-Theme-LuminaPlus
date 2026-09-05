import type { PingRecord } from "@/types/komari";
import { resolvePingRecordLossPercent, resolvePingSampleCounts } from "@/utils/pingMetrics";
import type { TimedMetricPoint } from "./chartData";

/** 输入按时间升序排列；邻近采样共享时间锚点，丢包率按原始样本数合并。 */
export function alignPingChartRecords(
  sortedRecords: Array<{ record: PingRecord; time: number }>,
  taskKeys: Set<string>,
  tolerance: number,
) {
  const latencyPointMap = new Map<number, TimedMetricPoint>();
  const lossPointMap = new Map<number, TimedMetricPoint>();
  const lossWeightMap = new Map<number, TimedMetricPoint>();
  let lastAnchor = Number.NEGATIVE_INFINITY;

  for (const { record, time } of sortedRecords) {
    const taskKey = String(record.task_id);
    if (!taskKeys.has(taskKey)) continue;
    const anchor = time - lastAnchor <= tolerance ? lastAnchor : time;
    lastAnchor = anchor;

    const latency = latencyPointMap.get(anchor) ?? { time: anchor };
    // 延迟沿用最新采样；0 是亚毫秒成功，负值才表示丢包。
    latency[taskKey] = record.value >= 0 ? record.value : null;
    latencyPointMap.set(anchor, latency);

    const loss = lossPointMap.get(anchor) ?? { time: anchor };
    const weights = lossWeightMap.get(anchor) ?? { time: anchor };
    const previousWeight = weights[taskKey] ?? 0;
    const weight = resolvePingSampleCounts(record).total;
    const totalWeight = previousWeight + weight;
    // 同任务也可能因采样抖动落入同一锚点，不能用后一条覆盖已有丢包和权重。
    loss[taskKey] =
      ((loss[taskKey] ?? 0) * previousWeight + resolvePingRecordLossPercent(record) * weight) /
      totalWeight;
    weights[taskKey] = totalWeight;
    lossPointMap.set(anchor, loss);
    lossWeightMap.set(anchor, weights);
  }

  return {
    latencyPoints: [...latencyPointMap.values()],
    lossPoints: [...lossPointMap.values()],
    lossWeightMap,
  };
}
