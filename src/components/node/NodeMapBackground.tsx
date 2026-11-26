import { memo, useMemo } from "react";
import worldMap from "@/assets/world-map.json";
import { getCountryCodeFromRegion } from "@/utils/geo";
import { NodeMapMeteors } from "./NodeMapMeteors";

const coordinates: Record<string, number[]> = worldMap.points;
const regionNames = new Intl.DisplayNames(["zh-Hans"], { type: "region" });

type MapNode = { region: string; online: boolean | null };
type MapRegionSummary = { total: number; online: number; offline: number };

function resolveMapRegionStatus(region: MapRegionSummary | undefined) {
  if (!region) return undefined;
  if (region.offline > 0) return "offline";
  if (region.online > 0) return "online";
  return "unknown";
}

const CountryShapes = memo(function CountryShapes({
  regions,
}: {
  regions: Map<string, MapRegionSummary>;
}) {
  return worldMap.countries.map(({ code, name, path }, index) => {
    const region = regions.get(code);
    const label = code.length === 2 ? regionNames.of(code) : name;
    return (
      <path
        key={`${code}-${name}-${index}`}
        d={path}
        className="node-map-country"
        data-status={resolveMapRegionStatus(region)}
      >
        <title>{region
          ? `${label}：${region.total} 台，${region.online} 在线，${region.offline} 离线`
          : label}</title>
      </path>
    );
  });
});

export function NodeMapBackground({ nodes }: { nodes: MapNode[] }) {
  // 流量刷新不改变地区与在线状态时，复用地图图形。
  const signature = nodes.map(({ region, online }) => `${getCountryCodeFromRegion(region) ?? ""}:${online}`).sort().join(",");
  const regions = useMemo(() => {
    const result = new Map<string, { total: number; online: number; offline: number }>();
    for (const item of signature.split(",")) {
      const [code, status] = item.split(":");
      if (!coordinates[code]) continue;
      const region = result.get(code) ?? { total: 0, online: 0, offline: 0 };
      region.total += 1;
      if (status === "true") region.online += 1;
      if (status === "false") region.offline += 1;
      result.set(code, region);
    }
    return result;
  }, [signature]);

  return (
    <div className="home-map-background">
      <svg viewBox="0 0 1000 420" role="img" aria-label="节点地区分布地图">
        <CountryShapes regions={regions} />
        <NodeMapMeteors
          regionCodes={Array.from(regions)
            .filter(([, region]) => region.online > 0)
            .map(([code]) => code)
            .join(",")}
          coordinates={coordinates}
        />
        {Array.from(regions, ([code, region], index) => {
          const [x, y] = coordinates[code];
          return (
            <g
              key={code}
              transform={`translate(${x} ${y})`}
              className="node-map-point"
              data-status={resolveMapRegionStatus(region)}
            >
              <title>{`${regionNames.of(code)}：${region.total} 台，${region.online} 在线，${region.offline} 离线`}</title>
              <circle
                className="node-map-point-pulse"
                r={region.total > 1 ? 10 : 5}
                style={{ animationDelay: `${-index * 0.37}s` }}
                aria-hidden="true"
              />
              <circle className="node-map-point-core" r={region.total > 1 ? 10 : 5} />
              {region.total > 1 && <text dy="0.35em" textAnchor="middle">{region.total}</text>}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
