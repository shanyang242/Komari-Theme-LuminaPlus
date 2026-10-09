import type { PingTask } from "@/types/komari";

/**
 * 首页单线路的逐节点覆盖：
 * - 缺少键：继承后端绑定，使用后端返回的第一个任务；
 * - 正整数：手动指定任务；
 * - null：明确不绑定任务。
 */
export type HomepagePingNodeTaskIds = Record<string, number | null>;

function parseTaskId(value: unknown) {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  if (typeof value !== "string" || !/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value.trim());
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function normalizeHomepagePingNodeTaskIds(
  value: unknown,
): HomepagePingNodeTaskIds {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const result: HomepagePingNodeTaskIds = {};
  const entries = Object.entries(value as Record<string, unknown>).sort(
    ([left], [right]) => left.trim().localeCompare(right.trim()),
  );
  for (const [rawUuid, rawTaskId] of entries) {
    const uuid = rawUuid.trim();
    if (!uuid) continue;
    if (rawTaskId === null) {
      result[uuid] = null;
      continue;
    }
    const taskId = parseTaskId(rawTaskId);
    if (taskId != null) result[uuid] = taskId;
  }
  return result;
}

/** 解析节点最终使用的单个探测任务；任务数组顺序由后端确定。 */
export function resolveHomepagePingTaskId(
  clientUuid: string,
  tasks: PingTask[],
  overrides: HomepagePingNodeTaskIds,
): number | null {
  if (!clientUuid) return null;
  if (Object.prototype.hasOwnProperty.call(overrides, clientUuid)) {
    return overrides[clientUuid] ?? null;
  }

  return tasks.find((task) => task.clients.includes(clientUuid))?.id ?? null;
}
