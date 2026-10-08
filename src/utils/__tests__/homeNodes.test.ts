import { describe, expect, it } from "vitest";
import type { HomeNodeSummary } from "@/services/wsStore";
import {
  getHomeGroupOptions,
  getHomeRegionOptions,
  mergeHomeOptionOrder,
  normalizeHomeGroupOrder,
  normalizeHomeRegionOrder,
  sortHomeGroupOptions,
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

describe("home region ordering", () => {
  const regions = (...codes: string[]) => codes.map((region) => ({ region }));

  it("keeps flag-derived codes sortable after normalizing the stored order", () => {
    const order = normalizeHomeRegionOrder(["XK", "UN", "UK", "US"]);
    expect(order).toEqual(["XK", "UN", "GB", "US"]);
    expect(getHomeRegionOptions(regions("US", "🇽🇰", "XK", "🇺🇳", "🇺🇰"), order)).toEqual([
      { code: "XK", count: 2 }, { code: "UN", count: 1 },
      { code: "GB", count: 1 }, { code: "US", count: 1 },
    ]);
  });

  it("preserves geographic priority and count/code tie-breakers by default", () => {
    const options = getHomeRegionOptions(regions(
      "AU", "US", "日本", "JP", "SG", "TW", "MO", "HK", "CN",
      "FR", "DE", "FR", "GB", "AU", "KR", "", "unknown",
    ));
    expect(options.map(({ code }) => code)).toEqual([
      "CN", "HK", "MO", "TW", "SG", "JP", "US", "FR", "DE", "GB", "AU", "UN", "KR",
    ]);
    expect(options.find(({ code }) => code === "JP")?.count).toBe(2);
    expect(options.find(({ code }) => code === "UN")?.count).toBe(2);
  });

  it("puts configured regions first and appends new regions in default order", () => {
    expect(getHomeRegionOptions(
      regions("CN", "JP", "US", "DE", "AU", "JP"),
      ["AU", "US"],
    )).toEqual([
      { code: "AU", count: 1 }, { code: "US", count: 1 },
      { code: "CN", count: 1 }, { code: "JP", count: 2 }, { code: "DE", count: 1 },
    ]);
  });

  it("keeps the relative order in a group without adding absent regions", () => {
    const order = ["DE", "US", "JP", "HK", "UN"];
    expect(getHomeRegionOptions(regions("HK", "JP", "JP"), order)).toEqual([
      { code: "JP", count: 2 }, { code: "HK", count: 1 },
    ]);
    expect(getHomeRegionOptions([], order)).toEqual([]);
    expect(getHomeRegionOptions(regions("", "US"), order)).toEqual([
      { code: "US", count: 1 }, { code: "UN", count: 1 },
    ]);
  });

  it("restores the default order when the custom order is cleared", () => {
    const nodes = regions("US", "HK", "JP");
    expect(getHomeRegionOptions(nodes, ["JP", "US", "HK"])[0].code).toBe("JP");
    expect(getHomeRegionOptions(nodes, []).map(({ code }) => code)).toEqual(["HK", "JP", "US"]);
  });

  it("normalizes stored codes, deduplicates aliases, and drops malformed entries", () => {
    expect(normalizeHomeRegionOrder([" jp ", "JP", "uk", "GB", "UN", "EU", "ZZ", "", null, 42, {}]))
      .toEqual(["JP", "GB", "UN", "EU"]);
    expect(normalizeHomeRegionOrder("JP")).toEqual([]);
    expect(normalizeHomeRegionOrder(undefined)).toEqual([]);
  });
});

describe("merging edited home option order", () => {
  it("keeps absent regions in their previous slots when they return", () => {
    const stored = Object.freeze(["JP", "US", "DE", "HK", "AU"]);
    const edited = Object.freeze(["HK", "SG", "US"]);
    const order = mergeHomeOptionOrder(stored, edited);
    expect(order).toEqual(["JP", "HK", "DE", "SG", "AU", "US"]);
    expect(getHomeRegionOptions([{ region: "US" }, { region: "HK" }, { region: "SG" }], order)
      .map(({ code }) => code)).toEqual(edited);
    expect(getHomeRegionOptions(stored.map((region) => ({ region })), order)
      .map(({ code }) => code)).toEqual(["JP", "HK", "DE", "AU", "US"]);
  });

  it("preserves absent group positions while replacing the visible order", () => {
    const order = mergeHomeOptionOrder(["香港", "旧分组", "美国"], ["美国", "香港"]);
    expect(sortHomeGroupOptions(["香港", "美国"], order)).toEqual(["美国", "香港"]);
    expect(sortHomeGroupOptions(["香港", "旧分组", "美国"], order))
      .toEqual(["美国", "旧分组", "香港"]);
  });

  it("materializes an automatic order on the first edit and retains history for an empty list", () => {
    expect(mergeHomeOptionOrder([], ["US", "JP"])).toEqual(["US", "JP"]);
    expect(mergeHomeOptionOrder(["JP", "US"], [])).toEqual(["JP", "US"]);
  });

  it("does not duplicate stored or newly available options", () => {
    expect(mergeHomeOptionOrder(["JP", "JP", "US"], ["US", "HK", "HK"]))
      .toEqual(["JP", "US", "HK"]);
  });
});
