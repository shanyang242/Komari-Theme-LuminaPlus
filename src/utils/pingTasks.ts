import type { PingTask } from "@/types/komari";

/** 首页节点单线路覆盖：缺键继承后端首任务，正整数手动指定，null 明确不绑定。 */
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
