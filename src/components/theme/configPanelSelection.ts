export function resolvePanelSelectedClient<T extends { uuid: string }>(
  clients: readonly T[],
  filteredClients: readonly T[],
  selectedUuid: string,
): T | undefined {
  if (selectedUuid) {
    const matched = clients.find((client) => client.uuid === selectedUuid);
    if (matched) return matched;
  }
  return filteredClients[0];
}

export function resolveNextSelectedUuid<T extends { uuid: string }>(
  clients: readonly T[],
  filteredClients: readonly T[],
  selectedUuid: string,
  filterChanged: boolean,
): string {
  if (filterChanged) {
    return filteredClients.some((client) => client.uuid === selectedUuid)
      ? selectedUuid
      : (filteredClients[0]?.uuid ?? "");
  }
  if (selectedUuid && clients.some((client) => client.uuid === selectedUuid)) {
    return selectedUuid;
  }
  return filteredClients[0]?.uuid ?? "";
}
