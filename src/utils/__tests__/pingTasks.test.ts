import { describe, expect, it } from "vitest";
import {
  normalizeHomepageMultiPingGroups,
  normalizeHomepageMultiPingTaskIds,
  invertHomepagePingTaskBindings,
  hasHomepagePingTaskBinding,
  normalizeHomepagePingTaskBindings,
  resolveHomepagePingSelections,
  resolveHomepagePingTaskIdsByClient,
  resolveHomepagePingTaskIdsByGroups,
} from "@/utils/pingTasks";

describe("homepage ping task bindings", () => {
  it("accepts only positive decimal safe integers", () => {
    expect(
      normalizeHomepagePingTaskBindings({
        "1e3": ["exponent"],
        "1.5": ["fraction"],
        "0x10": ["hex"],
        "9007199254740992": ["unsafe"],
        "42": ["valid"],
      }),
    ).toEqual({ "42": ["valid"] });
  });

  it("merges IDs that normalize to the same decimal integer", () => {
    expect(
      normalizeHomepagePingTaskBindings({
        "01": ["node-a", "node-b"],
        "1": ["node-b", "node-c"],
      }),
    ).toEqual({ "1": ["node-b", "node-c", "node-a"] });
  });

  it("inverts normalized bindings and gives the lowest task ID precedence", () => {
    expect(
      invertHomepagePingTaskBindings({
        "02": ["node-a"],
        "1": ["node-a", "node-b"],
      }),
    ).toEqual(
      new Map([
        ["node-a", 1],
        ["node-b", 1],
      ]),
    );
  });

  it("reuses the inverted binding index for a stable bindings object", () => {
    const bindings = { "8": ["node-a"], "9": ["node-b"] };
    expect(invertHomepagePingTaskBindings(bindings)).toBe(
      invertHomepagePingTaskBindings(bindings),
    );
  });

  it("reports a binding before overview data has loaded", () => {
    const bindings = { "8": ["node-a"], "9": ["node-b"] };
    expect(hasHomepagePingTaskBinding("node-a", bindings)).toBe(true);
    expect(hasHomepagePingTaskBinding("node-c", bindings)).toBe(false);
  });

  it("normalizes the global three-task selection in display order", () => {
    expect(normalizeHomepageMultiPingTaskIds(["3", 1, 3, 2, 4])).toEqual([3, 1, 2]);
  });

  it("uses the same three global tasks for every node and otherwise keeps single bindings", () => {
    const bindings = { "8": ["node-a"], "9": ["node-b"] };
    expect(
      resolveHomepagePingTaskIdsByClient(["node-a", "node-b"], bindings, [3, 1, 2]),
    ).toEqual(
      new Map([
        ["node-a", [3, 1, 2]],
        ["node-b", [3, 1, 2]],
      ]),
    );
    expect(resolveHomepagePingTaskIdsByClient(["node-a", "node-b"], bindings)).toEqual(
      new Map([
        ["node-a", [8]],
        ["node-b", [9]],
      ]),
    );
  });

  it("requests either global multi-ping tasks or per-node single bindings, never both", () => {
    const multiSelections = resolveHomepagePingSelections(
      ["node-a", "node-b"],
      { "8": ["node-a"], "9": ["node-b"] },
      [3, 1, 2],
    );

    expect(multiSelections.singleTaskIdsByClient).toEqual(new Map());
    expect(multiSelections.multiTaskIdsByClient).toEqual(
      new Map([
        ["node-a", [3, 1, 2]],
        ["node-b", [3, 1, 2]],
      ]),
    );
    expect(multiSelections.requestedTaskIdsByClient).toBe(
      multiSelections.multiTaskIdsByClient,
    );

    const singleSelections = resolveHomepagePingSelections(
      ["node-a", "node-b"],
      { "8": ["node-a"], "9": ["node-b"] },
    );
    expect(singleSelections.singleTaskIdsByClient).toEqual(
      new Map([
        ["node-a", [8]],
        ["node-b", [9]],
      ]),
    );
    expect(singleSelections.multiTaskIdsByClient).toEqual(new Map());
    expect(singleSelections.requestedTaskIdsByClient).toBe(
      singleSelections.singleTaskIdsByClient,
    );
  });
});

describe("homepage multi-ping groups (两套三网线路)", () => {
  it("falls back to the legacy single global group when no groups are configured", () => {
    expect(normalizeHomepageMultiPingGroups(undefined, [3, 1, 2])).toEqual([
      { taskIds: [3, 1, 2], clientUuids: [] },
    ]);
    expect(normalizeHomepageMultiPingGroups(undefined, [3, 1])).toEqual([]);
    expect(normalizeHomepageMultiPingGroups([], [3, 1, 2])).toEqual([
      { taskIds: [3, 1, 2], clientUuids: [] },
    ]);
  });

  it("normalizes each group: 3 unique tasks, deduped client uuids, drops empty groups", () => {
    expect(
      normalizeHomepageMultiPingGroups(
        [
          { taskIds: ["5", 5, 4, 6], clientUuids: ["a", "a", "b"] },
          { taskIds: [9, 8], clientUuids: ["c"] },
          { taskIds: [] },
        ],
        [1, 2, 3],
      ),
    ).toEqual([
      { taskIds: [5, 4, 6], clientUuids: ["a", "b"] },
      { taskIds: [9, 8], clientUuids: ["c"] },
    ]);
  });

  it("prefers configured groups over the legacy fallback", () => {
    expect(
      normalizeHomepageMultiPingGroups([{ taskIds: [1, 2, 3], clientUuids: [] }], [7, 8, 9]),
    ).toEqual([{ taskIds: [1, 2, 3], clientUuids: [] }]);
  });

  it("assigns nodes to their group, first group wins, catch-all absorbs the rest", () => {
    const groups = [
      { taskIds: [1, 2, 3], clientUuids: ["node-a", "node-b"] },
      { taskIds: [4, 5, 6], clientUuids: ["node-b", "node-c"] },
      { taskIds: [7, 8, 9], clientUuids: [] },
    ];
    expect(
      resolveHomepagePingTaskIdsByGroups(
        ["node-a", "node-b", "node-c", "node-d"],
        groups,
      ),
    ).toEqual(
      new Map([
        ["node-a", [1, 2, 3]],
        // node-b 命中第 1 组后不再参与第 2 组(互斥,顺序优先)
        ["node-b", [1, 2, 3]],
        ["node-c", [4, 5, 6]],
        // 兜底组吸收所有剩余节点
        ["node-d", [7, 8, 9]],
      ]),
    );
  });

  it("leaves unassigned nodes out when no catch-all group exists", () => {
    const groups = [
      { taskIds: [1, 2, 3], clientUuids: ["node-a"] },
      { taskIds: [4, 5, 6], clientUuids: ["node-b"] },
    ];
    expect(resolveHomepagePingTaskIdsByGroups(["node-a", "node-b", "node-c"], groups)).toEqual(
      new Map([
        ["node-a", [1, 2, 3]],
        ["node-b", [4, 5, 6]],
      ]),
    );
  });

  it("supports more than two groups with catch-all in the middle", () => {
    const groups = [
      { taskIds: [1, 2, 3], clientUuids: ["node-a"] },
      { taskIds: [4, 5, 6], clientUuids: [] },
      { taskIds: [7, 8, 9], clientUuids: ["node-b", "node-c"] },
      { taskIds: [10, 11, 12], clientUuids: ["node-d"] },
    ];
    expect(
      resolveHomepagePingTaskIdsByGroups(
        ["node-a", "node-b", "node-c", "node-d", "node-e"],
        groups,
      ),
    ).toEqual(
      new Map([
        ["node-a", [1, 2, 3]],
        // 兜底组(第 2 套)按顺序吸收全部剩余节点,其后的组不再获得任何节点
        ["node-b", [4, 5, 6]],
        ["node-c", [4, 5, 6]],
        ["node-d", [4, 5, 6]],
        ["node-e", [4, 5, 6]],
      ]),
    );
  });

  it("treats incomplete groups as unusable and falls back to legacy/single", () => {
    const groups = [{ taskIds: [1, 2], clientUuids: ["node-a"] }];
    expect(resolveHomepagePingTaskIdsByGroups(["node-a"], groups)).toEqual(new Map());
  });

  it("uses per-group assignments in selections and skips single bindings", () => {
    const groups = [
      { taskIds: [1, 2, 3], clientUuids: ["node-a"] },
      { taskIds: [4, 5, 6], clientUuids: [] },
    ];
    const selections = resolveHomepagePingSelections(
      ["node-a", "node-b"],
      { "8": ["node-a"], "9": ["node-b"] },
      [],
      groups,
    );
    expect(selections.singleTaskIdsByClient).toEqual(new Map());
    expect(selections.multiTaskIdsByClient).toEqual(
      new Map([
        ["node-a", [1, 2, 3]],
        ["node-b", [4, 5, 6]],
      ]),
    );
    expect(selections.requestedTaskIdsByClient).toBe(selections.multiTaskIdsByClient);
  });

  it("keeps legacy global multi-ping behavior when groups are absent", () => {
    const selections = resolveHomepagePingSelections(
      ["node-a", "node-b"],
      {},
      [3, 1, 2],
      [],
    );
    expect(selections.multiTaskIdsByClient).toEqual(
      new Map([
        ["node-a", [3, 1, 2]],
        ["node-b", [3, 1, 2]],
      ]),
    );
  });
});
