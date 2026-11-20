import type { PingRecord } from "@/types/komari";
import type { TimedMetricPoint } from "./chartData";

/** 邻近采样归并到共享时间锚点（输入需按时间升序）。 */
export function alignPingChartRecords(
  sortedRecords: Array<{ record: PingRecord; time: number }>,
  taskKeys: Set<string>,
  tolerance: number,
) {
  const latencyPointMap = new Map<number, TimedMetricPoint>();
  let lastAnchor = Number.NEGATIVE_INFINITY;

  for (const { record, time } of sortedRecords) {
    const taskKey = String(record.task_id);
    if (!taskKeys.has(taskKey)) continue;
    const anchor = time - lastAnchor <= tolerance ? lastAnchor : time;
    lastAnchor = anchor;

    const latency = latencyPointMap.get(anchor) ?? { time: anchor };
    // 0 为亚毫秒成功，负值为断点
    latency[taskKey] = record.value >= 0 ? record.value : null;
    latencyPointMap.set(anchor, latency);
  }

  return { latencyPoints: [...latencyPointMap.values()] };
}

export function pingLossMarkers(
  records: Array<{ record: PingRecord; time: number }>,
  visibleTaskIds: Set<number>,
) {
  const markers = new Map<string, { time: number; taskId: number }>();
  for (const { record, time } of records) {
    if (!Number.isFinite(time) || time <= 0 || !visibleTaskIds.has(record.task_id)) continue;
    const aggregateLoss = record.loss;
    if (record.value >= 0 &&
      !(typeof aggregateLoss === "number" && Number.isFinite(aggregateLoss) && aggregateLoss > 0)) {
      continue;
    }
    markers.set(`${record.task_id}:${time}`, { time, taskId: record.task_id });
  }
  return [...markers.values()];
}
