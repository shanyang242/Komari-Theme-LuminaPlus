import { describe, expect, it } from "vitest";
import worldMap from "@/assets/world-map.json";
import {
  buildMapRegionSummary,
  buildMapSignature,
  buildMeteorRoute,
  EXTRA_MAP_POINTS,
  getCountryMapStatus,
  getPointMapStatus,
  getRegionDisplayName,
  resolveMapPointPositions,
} from "../nodeMapData";

describe("world-map.json & region labels", () => {
  it("contains valid compact SVG paths and unique generated country keys", () => {
    expect(worldMap.countries.length).toBeGreaterThan(200);
    const ids = new Set<string>();
    for (let i = 0; i < worldMap.countries.length; i += 1) {
      const { code, name, path } = worldMap.countries[i];
      expect(path.startsWith("M")).toBe(true);
      const id = `${code || name || "unassigned"}-${i}`;
      expect(ids.has(id)).toBe(false);
      ids.add(id);
    }
  });

  it("handles unassigned polygons and non-standard region codes without throwing", () => {
    expect(getRegionDisplayName("", "")).toBe("");
    expect(getRegionDisplayName("Siachen Glacier", "Siachen Glacier")).toBe("Siachen Glacier");
    expect(getRegionDisplayName("XK", "Kosovo").length).toBeGreaterThan(0);
    expect(getRegionDisplayName("CN", "China")).toContain("中国");
  });
});

describe("buildMapSignature & buildMapRegionSummary", () => {
  const coordinates = worldMap.points;

  it("produces an order-independent signature and ignores unmapped regions", () => {
    const sigA = buildMapSignature([
      { region: "🇺🇸", online: true },
      { region: "🇯🇵", online: false },
      { region: "unknown-planet", online: true },
    ], coordinates);
    const sigB = buildMapSignature([
      { region: "JP", online: false },
      { region: "unknown-planet", online: false },
      { region: "US", online: true },
    ], coordinates);

    expect(sigA).toBe("JP:1:0:1,US:1:1:0");
    expect(sigB).toBe(sigA);
    expect(buildMapSignature([{ region: "", online: true }], coordinates)).toBe("");
  });

  it("distinguishes reachable country fill from partial-offline marker warning", () => {
    const signature = buildMapSignature([
      { region: "US", online: true },
      { region: "US", online: false },
      { region: "JP", online: true },
      { region: "DE", online: false },
      { region: "SG", online: null },
    ], coordinates);
    const summary = buildMapRegionSummary(signature, coordinates);

    const us = summary.regionsByCode.get("US");
    expect(us).toEqual({ total: 2, online: 1, offline: 1 });
    expect(getCountryMapStatus(us)).toBe("online");
    expect(getPointMapStatus(us!)).toBe("offline");

    const de = summary.regionsByCode.get("DE");
    expect(getCountryMapStatus(de)).toBe("offline");
    expect(getPointMapStatus(de!)).toBe("offline");

    const sg = summary.regionsByCode.get("SG");
    expect(getCountryMapStatus(sg)).toBe("unknown");
    expect(getPointMapStatus(sg!)).toBe("unknown");

    // 仅含在线节点的地区参与航线流星动画。
    expect(summary.onlinePoints.map((point) => point.code)).toEqual(["JP", "US"]);
    expect(summary.points.map((point) => point.code)).toEqual(["DE", "JP", "SG", "US"]);
  });

  it("aggregates node counts without growing the signature per node", () => {
    const nodes = Array.from({ length: 1000 }, (_, index) => ({
      region: index % 2 === 0 ? "US" : "🇺🇸",
      online: index < 700 ? true : index < 900 ? false : null,
    }));
    const signature = buildMapSignature(nodes, coordinates);
    expect(signature).toBe("US:1000:700:200");
    expect(buildMapRegionSummary(signature, coordinates).regionsByCode.get("US"))
      .toEqual({ total: 1000, online: 700, offline: 200 });
  });

  it("ignores recognized regions that lack usable coordinates", () => {
    const nodes = [
      { region: "JP", online: true },
      { region: "US", online: false },
      { region: "HK", online: true },
    ];
    expect(buildMapSignature(nodes, { JP: coordinates.JP, HK: [100] })).toBe("JP:1:1:0");
    expect(buildMapRegionSummary("", coordinates).points).toEqual([]);
  });

  it("supports EU aggregate region points", () => {
    const mergedCoords = { ...EXTRA_MAP_POINTS, ...coordinates };
    const sig = buildMapSignature([{ region: "🇪🇺", online: true }], mergedCoords);
    const summary = buildMapRegionSummary(sig, mergedCoords);
    expect(summary.points).toHaveLength(1);
    expect(summary.points[0]?.code).toBe("EU");
  });

  it("separates Hong Kong and Macao and uses those same positions for routes", () => {
    const nodes = [
      { region: "HK", online: true },
      { region: "MO", online: true },
      { region: "JP", online: false },
    ];
    const summary = buildMapRegionSummary(buildMapSignature(nodes, coordinates), coordinates);
    const [hk, mo] = summary.onlinePoints;
    expect(hk.code).toBe("HK");
    expect(mo.code).toBe("MO");
    expect(Math.hypot(hk.x - mo.x, hk.y - mo.y)).toBeGreaterThan(11.8);
    expect(summary.points).toContain(hk);
    expect(summary.points).toContain(mo);
    expect(buildMeteorRoute([hk.x, hk.y], [mo.x, mo.y])?.path)
      .toMatch(new RegExp(`^M ${hk.x} ${hk.y} Q .+ ${mo.x} ${mo.y}$`));
    const reordered = buildMapRegionSummary(buildMapSignature([...nodes].reverse(), coordinates), coordinates);
    expect(reordered.points).toEqual(summary.points);
  });

  it("keeps every marker centre independently reachable with all supported regions present", () => {
    const nodes = Object.keys(coordinates).map((region) => ({ region, online: true }));
    const { points } = buildMapRegionSummary(buildMapSignature(nodes, coordinates), coordinates);
    for (const point of points) {
      for (const other of points) {
        if (point === other) continue;
        // 覆盖命中圆以及悬停时放大的核心圆和描边。
        expect(Math.hypot(point.x - other.x, point.y - other.y)).toBeGreaterThan(7.1);
      }
    }
  });

  it("separates coincident markers without mutating the input", () => {
    const input = [
      { code: "HK", x: 800, y: 170 },
      { code: "MO", x: 800, y: 170 },
    ];
    const [a, b] = resolveMapPointPositions(input);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(11.8);
    expect(input[0]).toEqual({ code: "HK", x: 800, y: 170 });
    expect(input[1]).toEqual({ code: "MO", x: 800, y: 170 });
  });
});

describe("buildMeteorRoute", () => {
  it("rejects zero-distance pairs and bounds the SVG mask tightly to the curve", () => {
    expect(buildMeteorRoute([100, 100], [100, 100])).toBeNull();
    const route = buildMeteorRoute(worldMap.points.HK, worldMap.points.JP);
    expect(route).not.toBeNull();
    expect(route!.path.startsWith("M ")).toBe(true);
    expect(route!.maskWidth * route!.maskHeight).toBeLessThan(1200 * 620 * 0.1);
  });
});
