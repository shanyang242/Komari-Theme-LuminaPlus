import type { PingRecord, PingTask } from "@/types/komari";

/**
 * 首页单线路的逐节点覆盖：
 * - 缺少键：继承后端绑定并按任务权重自动选择；
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

/** 把旧版「任务 → 节点」单线路配置迁移成逐节点覆盖。 */
export function migrateLegacyHomepagePingBindings(
  value: unknown,
): HomepagePingNodeTaskIds {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const result: HomepagePingNodeTaskIds = {};
  const entries = Object.entries(value as Record<string, unknown>)
    .map(([rawTaskId, clients]) => [parseTaskId(rawTaskId), clients] as const)
    .filter((entry): entry is readonly [number, unknown] => entry[0] != null)
    .sort(([left], [right]) => left - right);

  for (const [taskId, rawClients] of entries) {
    if (!Array.isArray(rawClients)) continue;
    for (const rawClient of rawClients) {
      const uuid = typeof rawClient === "string" ? rawClient.trim() : "";
      if (uuid && !(uuid in result)) result[uuid] = taskId;
    }
  }
  return result;
}

export function sortHomepagePingTasks(tasks: PingTask[]) {
  // 公开接口在旧版 Komari 中不返回 weight，但数组本身已按 weight、id 排序。
  // 此时 schema 会把所有 weight 补成 0，必须保留后台顺序；只要存在明确权重，
  // 就按 Komari 的 weight、id 规则重排。
  if (tasks.every((task) => task.weight === 0)) return [...tasks];
  return [...tasks].sort((left, right) =>
    left.weight - right.weight || left.id - right.id,
  );
}

/**
 * 解析节点最终使用的单个探测任务。自动模式优先使用后端 clients 绑定；若旧后端没有
 * 返回绑定列表，则从该节点实际存在的记录反推候选任务，并仍按任务权重排序。
 */
export function resolveHomepagePingTaskId(
  clientUuid: string,
  tasks: PingTask[],
  overrides: HomepagePingNodeTaskIds,
  records: Array<Pick<PingRecord, "client" | "task_id">> = [],
  allowRecordFallback = true,
): number | null {
  if (!clientUuid) return null;
  if (Object.prototype.hasOwnProperty.call(overrides, clientUuid)) {
    return overrides[clientUuid] ?? null;
  }

  const orderedTasks = sortHomepagePingTasks(tasks);
  const boundTask = orderedTasks.find((task) => task.clients.includes(clientUuid));
  if (boundTask) return boundTask.id;

  if (!allowRecordFallback) return null;

  const recordedTaskIds = new Set(
    records
      .filter((record) => record.client === clientUuid)
      .map((record) => record.task_id)
      .filter((taskId) => Number.isSafeInteger(taskId) && taskId > 0),
  );
  const recordedTask = orderedTasks.find((task) => recordedTaskIds.has(task.id));
  if (recordedTask) return recordedTask.id;
  return [...recordedTaskIds].sort((left, right) => left - right)[0] ?? null;
}
