import type { HomepageMultiPingGroup } from "@/types/komari";
export type { HomepageMultiPingGroup };

export type HomepagePingTaskBindings = Record<string, string[]>;
export const HOMEPAGE_MULTI_PING_TASK_COUNT = 3;
/** 管理页支持的「三网线路组」数量(第二套起可选配置)。 */
export const HOMEPAGE_MULTI_PING_GROUP_COUNT = 2;

const invertedBindingsCache = new WeakMap<HomepagePingTaskBindings, Map<string, number>>();

function parseTaskId(taskId: string) {
  if (!/^\d+$/.test(taskId)) return null;
  const parsed = Number(taskId);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function normalizeHomepageMultiPingTaskIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];

  const normalized: number[] = [];
  for (const raw of value) {
    const taskId =
      typeof raw === "number" && Number.isSafeInteger(raw) && raw > 0
        ? raw
        : typeof raw === "string"
          ? parseTaskId(raw)
          : null;
    if (taskId == null || normalized.includes(taskId)) continue;
    normalized.push(taskId);
    if (normalized.length === HOMEPAGE_MULTI_PING_TASK_COUNT) break;
  }
  return normalized;
}

/**
 * 归一化一组三网线路。taskIds 最多取 3 个;clientUuids 去重保留字符串。
 * 返回 null 表示该组未配置任何任务(应被过滤)。
 */
export function normalizeHomepageMultiPingGroup(
  value: unknown,
): HomepageMultiPingGroup | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const taskIds = normalizeHomepageMultiPingTaskIds(record.taskIds);
  if (taskIds.length === 0) return null;

  const rawClients = Array.isArray(record.clientUuids) ? record.clientUuids : [];
  const clientUuids = Array.from(
    new Set(rawClients.filter((client): client is string => typeof client === "string" && client.trim() !== "")),
  );
  return { taskIds, clientUuids };
}

/**
 * 归一化多套三网线路配置。
 * - 新字段 homepageMultiPingGroups 有效时以其为准(空 clientUuids = 兜底组);
 * - 否则回落到旧字段 homepageMultiPingTaskIds(单组、全部节点),保证存量配置升级后行为不变。
 */
export function normalizeHomepageMultiPingGroups(
  groupsValue: unknown,
  legacyTaskIdsValue: unknown,
): HomepageMultiPingGroup[] {
  if (Array.isArray(groupsValue)) {
    const groups = groupsValue
      .map((group) => normalizeHomepageMultiPingGroup(group))
      .filter((group): group is HomepageMultiPingGroup => group !== null);
    if (groups.length > 0) return groups;
  }

  const legacyTaskIds = normalizeHomepageMultiPingTaskIds(legacyTaskIdsValue);
  if (legacyTaskIds.length === HOMEPAGE_MULTI_PING_TASK_COUNT) {
    return [{ taskIds: legacyTaskIds, clientUuids: [] }];
  }
  return [];
}

export function normalizeHomepagePingTaskBindings(
  value: unknown,
): HomepagePingTaskBindings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const normalized: HomepagePingTaskBindings = {};
  for (const [taskId, clients] of Object.entries(value)) {
    const numericTaskId = parseTaskId(taskId);
    if (numericTaskId == null || !Array.isArray(clients)) continue;

    const uniqueClients = Array.from(
      new Set(
        clients
          .map((client) => (typeof client === "string" ? client.trim() : ""))
          .filter(Boolean),
      ),
    );
    if (uniqueClients.length === 0) {
      continue;
    }

    const normalizedTaskId = String(numericTaskId);
    normalized[normalizedTaskId] = Array.from(
      new Set([...(normalized[normalizedTaskId] ?? []), ...uniqueClients]),
    );
  }

  return normalized;
}

export function invertHomepagePingTaskBindings(
  bindings: HomepagePingTaskBindings,
): Map<string, number> {
  const cached = invertedBindingsCache.get(bindings);
  if (cached) return cached;

  const selectedTaskByClient = new Map<string, number>();
  const entries = Object.entries(normalizeHomepagePingTaskBindings(bindings)).sort(
    ([left], [right]) => Number(left) - Number(right),
  );

  for (const [taskId, clients] of entries) {
    const numericTaskId = parseTaskId(taskId);
    if (numericTaskId == null) continue;
    for (const client of clients) {
      if (!selectedTaskByClient.has(client)) {
        selectedTaskByClient.set(client, numericTaskId);
      }
    }
  }

  invertedBindingsCache.set(bindings, selectedTaskByClient);
  return selectedTaskByClient;
}

export function hasHomepagePingTaskBinding(
  clientUuid: string,
  bindings: HomepagePingTaskBindings,
): boolean {
  return Boolean(clientUuid) && invertHomepagePingTaskBindings(bindings).has(clientUuid);
}

export function hasUsableHomepageMultiPingGroups(
  groups: HomepageMultiPingGroup[] | undefined,
): boolean {
  return Array.isArray(groups) && groups.some(
    (group) => normalizeHomepageMultiPingTaskIds(group.taskIds).length === HOMEPAGE_MULTI_PING_TASK_COUNT,
  );
}

/**
 * 按多套三网线路把节点分配到各自的任务组。
 * - 组按顺序优先:一个节点命中第一个含它的组后不再参与后续组;
 * - clientUuids 为空的组是「兜底组」:吸收所有尚未分配的节点;
 * - 未命中任何组的节点不进入结果(调用方回落单线路绑定)。
 */
export function resolveHomepagePingTaskIdsByGroups(
  clientUuids: string[],
  groups: HomepageMultiPingGroup[],
): Map<string, number[]> {
  const selectedTaskIdsByClient = new Map<string, number[]>();
  const usableGroups = (groups ?? [])
    .map((group) => ({
      taskIds: normalizeHomepageMultiPingTaskIds(group.taskIds),
      clientUuids: Array.from(new Set((group.clientUuids ?? []).filter(Boolean))),
    }))
    .filter((group) => group.taskIds.length === HOMEPAGE_MULTI_PING_TASK_COUNT);
  if (usableGroups.length === 0) return selectedTaskIdsByClient;

  const remaining = new Set(clientUuids.filter(Boolean));
  for (const group of usableGroups) {
    const members =
      group.clientUuids.length === 0
        ? remaining
        : new Set(group.clientUuids.filter((uuid) => remaining.has(uuid)));
    for (const uuid of members) {
      selectedTaskIdsByClient.set(uuid, group.taskIds);
      remaining.delete(uuid);
    }
    if (remaining.size === 0) break;
  }
  return selectedTaskIdsByClient;
}

export function resolveHomepagePingTaskIdsByClient(
  clientUuids: string[],
  bindings: HomepagePingTaskBindings,
  multiTaskIds: number[] = [],
  multiGroups: HomepageMultiPingGroup[] = [],
): Map<string, number[]> {
  const groupAssignments = resolveHomepagePingTaskIdsByGroups(clientUuids, multiGroups);
  if (groupAssignments.size > 0) return groupAssignments;

  const selectedTaskIds = normalizeHomepageMultiPingTaskIds(multiTaskIds);
  const selectedTaskIdsByClient = new Map<string, number[]>();

  if (selectedTaskIds.length === HOMEPAGE_MULTI_PING_TASK_COUNT) {
    for (const uuid of clientUuids) {
      if (uuid) selectedTaskIdsByClient.set(uuid, selectedTaskIds);
    }
    return selectedTaskIdsByClient;
  }

  const singleTaskByClient = invertHomepagePingTaskBindings(bindings);
  for (const uuid of clientUuids) {
    const taskId = singleTaskByClient.get(uuid);
    if (taskId != null) selectedTaskIdsByClient.set(uuid, [taskId]);
  }
  return selectedTaskIdsByClient;
}

export function resolveHomepagePingSelections(
  clientUuids: string[],
  bindings: HomepagePingTaskBindings,
  multiTaskIds: number[] = [],
  multiGroups: HomepageMultiPingGroup[] = [],
) {
  const groupAssignments = resolveHomepagePingTaskIdsByGroups(clientUuids, multiGroups);
  const useMultiPing =
    groupAssignments.size > 0 ||
    normalizeHomepageMultiPingTaskIds(multiTaskIds).length === HOMEPAGE_MULTI_PING_TASK_COUNT;
  const singleTaskIdsByClient = useMultiPing
    ? new Map<string, number[]>()
    : resolveHomepagePingTaskIdsByClient(clientUuids, bindings);
  const multiTaskIdsByClient = useMultiPing
    ? groupAssignments.size > 0
      ? groupAssignments
      : resolveHomepagePingTaskIdsByClient(
          clientUuids,
          {},
          multiTaskIds,
        )
    : new Map<string, number[]>();

  return {
    singleTaskIdsByClient,
    multiTaskIdsByClient,
    requestedTaskIdsByClient: useMultiPing
      ? multiTaskIdsByClient
      : singleTaskIdsByClient,
  };
}
