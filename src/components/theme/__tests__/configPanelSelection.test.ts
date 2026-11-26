import { describe, expect, it } from "vitest";
import {
  resolveNextSelectedUuid,
  resolvePanelSelectedClient,
} from "@/components/theme/configPanelSelection";

const CLIENTS = [
  { uuid: "node-a", name: "Node A" },
  { uuid: "node-b", name: "Node B" },
  { uuid: "node-c", name: "Node C" },
];

describe("config panel selection stability", () => {
  it("keeps editing the selected node even after edits remove it from the active filter", () => {
    const filteredAfterEdit = [CLIENTS[1], CLIENTS[2]];
    expect(resolvePanelSelectedClient(CLIENTS, filteredAfterEdit, "node-a")?.uuid).toBe("node-a");
    expect(resolveNextSelectedUuid(CLIENTS, filteredAfterEdit, "node-a", false)).toBe("node-a");
  });

  it("switches to the first matching node when the user changes filter criteria", () => {
    const filtered = [CLIENTS[1], CLIENTS[2]];
    expect(resolveNextSelectedUuid(CLIENTS, filtered, "node-a", true)).toBe("node-b");
    expect(resolveNextSelectedUuid(CLIENTS, filtered, "node-c", true)).toBe("node-c");
  });

  it("clears selection instead of falling back to an unmatched node when filter has zero matches", () => {
    expect(resolveNextSelectedUuid(CLIENTS, [], "node-a", true)).toBe("");
    expect(resolveNextSelectedUuid(CLIENTS, [], "", false)).toBe("");
    expect(resolvePanelSelectedClient(CLIENTS, [], "")).toBeUndefined();
  });

  it("falls back to the first filtered node if the selected node was deleted from clients", () => {
    const filtered = [CLIENTS[1]];
    expect(resolvePanelSelectedClient(CLIENTS, filtered, "removed")?.uuid).toBe("node-b");
    expect(resolveNextSelectedUuid(CLIENTS, filtered, "removed", false)).toBe("node-b");
  });
});
