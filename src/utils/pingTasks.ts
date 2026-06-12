export type HomepagePingTaskBindings = Record<string, string[]>;

export function normalizeHomepagePingTaskBindings(
  value: unknown,
): HomepagePingTaskBindings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const normalized: HomepagePingTaskBindings = {};
  for (const [taskId, clients] of Object.entries(value)) {
    const numericTaskId = Number(taskId);
    if (!Number.isInteger(numericTaskId) || numericTaskId <= 0) {
      continue;
    }

    if (!Array.isArray(clients)) {
      continue;
    }

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

    normalized[String(numericTaskId)] = uniqueClients;
  }

  return normalized;
}

export function invertHomepagePingTaskBindings(
  bindings: HomepagePingTaskBindings,
): Map<string, number> {
  const selectedTaskByClient = new Map<string, number>();
  const entries = Object.entries(bindings).sort(
    ([left], [right]) => Number(left) - Number(right),
  );

  for (const [taskId, clients] of entries) {
    const numericTaskId = Number(taskId);
    if (!Number.isInteger(numericTaskId) || numericTaskId <= 0) {
      continue;
    }
    for (const client of clients) {
      if (!selectedTaskByClient.has(client)) {
        selectedTaskByClient.set(client, numericTaskId);
      }
    }
  }

  return selectedTaskByClient;
}
