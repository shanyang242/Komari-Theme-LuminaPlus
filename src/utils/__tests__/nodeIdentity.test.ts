import { describe, expect, it } from "vitest";
import type { NodeInfo } from "@/types/komari";
import {
  collectMatchingNodeUuids,
  normalizeNodeIdentityList,
} from "@/utils/nodeIdentity";

function node(partial: Partial<NodeInfo> & Record<string, unknown>): NodeInfo {
  return { uuid: "", name: "", ...partial } as NodeInfo;
}

describe("normalizeNodeIdentityList", () => {
  it("splits on newlines / commas / semicolons, trims and dedupes", () => {
    expect(normalizeNodeIdentityList("a, b\nc；a ; ")).toEqual(["a", "b", "c"]);
    expect(normalizeNodeIdentityList(["x", " x ", ""])).toEqual(["x"]);
    expect(normalizeNodeIdentityList(undefined)).toEqual([]);
  });
});

describe("collectMatchingNodeUuids", () => {
  const nodes = [
    node({ uuid: "uuid-1", name: "东京-01" }),
    node({ uuid: "uuid-2", name: "Osaka" }),
    node({ uuid: "uuid-3", name: "HK", display_name: "香港节点" }),
  ];

  it("matches by name (case-insensitive) and by uuid", () => {
    const matched = collectMatchingNodeUuids(nodes, ["东京-01", "UUID-2"]);
    expect([...matched].sort()).toEqual(["uuid-1", "uuid-2"]);
  });

  it("matches on alternate identity fields like display_name", () => {
    expect([...collectMatchingNodeUuids(nodes, ["香港节点"])]).toEqual(["uuid-3"]);
  });

  it("returns an empty set when the list is empty or nothing matches", () => {
    expect(collectMatchingNodeUuids(nodes, []).size).toBe(0);
    expect(collectMatchingNodeUuids(nodes, ["不存在"]).size).toBe(0);
  });
});
