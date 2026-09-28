import { describe, expect, it } from "vitest";
import type { HomeNodeSummary } from "@/services/wsStore";
import { getHomeGroupOptions, moveOfflineHomeNodesLast } from "@/utils/homeNodes";

function node(partial: Partial<HomeNodeSummary> & Pick<HomeNodeSummary, "uuid">): HomeNodeSummary {
  return {
    group: "",
    hidden: false,
    region: "",
    online: true,
    trafficDown: 0,
    trafficUp: 0,
    netDown: 0,
    netUp: 0,
    weight: 0,
    ...partial,
  };
}

describe("home node helpers", () => {
  it("moves only explicitly offline instances to the end", () => {
    const nodes = [
      node({ uuid: "offline-a", online: false, weight: 1 }),
      node({ uuid: "online-a", online: true, weight: 2 }),
      node({ uuid: "unknown", online: null, weight: 3 }),
      node({ uuid: "offline-b", online: false, weight: 4 }),
      node({ uuid: "online-b", online: true, weight: 5 }),
    ];

    expect(moveOfflineHomeNodesLast(nodes).map((item) => item.uuid)).toEqual([
      "online-a",
      "unknown",
      "online-b",
      "offline-a",
      "offline-b",
    ]);
  });

  it("preserves Komari order inside both status groups", () => {
    const nodes = [
      node({ uuid: "offline-first", online: false }),
      node({ uuid: "online-first" }),
      node({ uuid: "offline-second", online: false }),
      node({ uuid: "online-second" }),
    ];
    const sorted = moveOfflineHomeNodesLast(nodes);
    expect(sorted.slice(0, 2).map((item) => item.uuid)).toEqual(["online-first", "online-second"]);
    expect(sorted.slice(2).map((item) => item.uuid)).toEqual(["offline-first", "offline-second"]);
  });

  it("builds group tabs from non-empty backend groups and keeps first-seen order", () => {
    expect(
      getHomeGroupOptions([
        node({ uuid: "a", group: "US 美国" }),
        node({ uuid: "b", group: "HK 香港" }),
        node({ uuid: "c", group: "US 美国" }),
        node({ uuid: "d", group: "" }),
      ]),
    ).toEqual(["US 美国", "HK 香港"]);
  });
});
