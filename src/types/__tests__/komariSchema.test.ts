import { describe, expect, it } from "vitest";
import { NodeInfoSchema } from "@/types/komari";

describe("Komari schemas", () => {
  it("exposes transformed node fields through the schema output", () => {
    const node = NodeInfoSchema.parse({ uuid: "node-a", group: null, region: null });
    expect(node.group).toBe("");
    expect(node.region).toBe("");
    expect(node.traffic_reset_day).toBe(0);
  });

  it("accepts the optional traffic reset day from an adapted backend", () => {
    expect(NodeInfoSchema.parse({ uuid: "node-a", traffic_reset_day: "31" }).traffic_reset_day).toBe(31);
  });

});
