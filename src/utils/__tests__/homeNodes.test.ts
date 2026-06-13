import { describe, expect, it } from "vitest";
import type { HomeNodeSummary } from "@/services/wsStore";
import {
  getHomeGroupOptions,
  normalizeHomeGroupOrder,
  sortHomeGroupOptions,
  sortHomeNodeSummaries,
} from "@/utils/homeNodes";

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

  it("moves offline nodes behind online nodes without crossing the filtered set", () => {
    const sorted = sortHomeNodeSummaries(
      [
        node({ uuid: "offline-low", online: false, weight: 1 }),
        node({ uuid: "online-high", online: true, weight: 8 }),
        node({ uuid: "online-low", online: true, weight: 2 }),
        node({ uuid: "unknown", online: null, weight: 0 }),
      ],
      true,
    );

    expect(sorted.map((item) => item.uuid)).toEqual([
      "unknown",
      "online-low",
      "online-high",
      "offline-low",
    ]);
  });

  it("preserves backend order when offline sorting is disabled", () => {
    const nodes = [
      node({ uuid: "offline", online: false, weight: 1 }),
      node({ uuid: "online", online: true, weight: 2 }),
    ];

    expect(sortHomeNodeSummaries(nodes, false)).toBe(nodes);
  });
});

describe("home group ordering", () => {
  it("normalizeHomeGroupOrder trims, drops empties, dedupes, and rejects non-arrays", () => {
    expect(normalizeHomeGroupOrder([" A ", "B", "A", "", null, "B"])).toEqual(["A", "B"]);
    expect(normalizeHomeGroupOrder("nope")).toEqual([]);
    expect(normalizeHomeGroupOrder(undefined)).toEqual([]);
  });

  it("returns the original order when no custom order is set", () => {
    const groups = ["US", "HK", "JP"];
    expect(sortHomeGroupOptions(groups, [])).toBe(groups);
  });

  it("places configured groups first, then appends the rest in original order", () => {
    expect(sortHomeGroupOptions(["US", "HK", "JP", "SG"], ["JP", "US"])).toEqual([
      "JP",
      "US",
      "HK",
      "SG",
    ]);
  });

  it("ignores configured groups that no longer exist and never duplicates", () => {
    expect(sortHomeGroupOptions(["US", "HK"], ["GONE", "HK", "HK"])).toEqual(["HK", "US"]);
  });
});
