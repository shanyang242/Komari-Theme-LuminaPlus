import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent } from "react";
import worldMap from "@/assets/world-map.json";
import { supportsFineHover } from "@/utils/mediaQuery";
import {
  buildMapRegionSummary,
  buildMapSignature,
  EXTRA_MAP_POINTS,
  getCountryMapStatus,
  getRegionDisplayName,
  type MapNodeInput,
  type MapRegionStats,
} from "./nodeMapData";
import { NodeMapMeteors } from "./NodeMapMeteors";

const coordinates: Record<string, readonly number[]> = {
  ...EXTRA_MAP_POINTS,
  ...worldMap.points,
};

const STATIC_COUNTRIES = worldMap.countries.map(({ code, name, path }, index) => ({
  id: `${code || name || "unassigned"}-${index}`,
  code,
  label: getRegionDisplayName(code, name),
  path,
}));

const CountryShapes = memo(function CountryShapes({
  regionsByCode,
}: {
  regionsByCode: ReadonlyMap<string, MapRegionStats>;
}) {
  return STATIC_COUNTRIES.map(({ id, code, label, path }) => {
    const region = code ? regionsByCode.get(code) : undefined;
    const interactive = Boolean(label);
    return (
      <path
        key={id}
        d={path}
        className="node-map-country"
        data-interactive={interactive ? undefined : "false"}
        data-status={getCountryMapStatus(region)}
      >
        {interactive && (
          <title>
            {region
              ? `${label}：${region.total} 台，${region.online} 在线，${region.offline} 离线`
              : label}
          </title>
        )}
      </path>
    );
  });
});

export function NodeMapBackground({ nodes }: { nodes: ReadonlyArray<MapNodeInput> }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState(() => typeof document === "undefined" || !document.hidden);
  const [hoverEnabled, setHoverEnabled] = useState(false);

  const updateHoverInput = (event: PointerEvent<SVGSVGElement>) => {
    const next = supportsFineHover(event.pointerType);
    if (next !== hoverEnabled) setHoverEnabled(next);
  };

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    let inViewport = true;
    const updateActivity = () => setActive(inViewport && !document.hidden);
    const observer = typeof IntersectionObserver === "undefined"
      ? null
      : new IntersectionObserver(([entry]) => {
          if (!entry) return;
          inViewport = entry.isIntersecting;
          updateActivity();
        });
    observer?.observe(element);
    document.addEventListener("visibilitychange", updateActivity);
    updateActivity();
    return () => {
      observer?.disconnect();
      document.removeEventListener("visibilitychange", updateActivity);
    };
  }, []);

  // 仅地区计数变化时重建地图摘要
  const signature = useMemo(() => buildMapSignature(nodes, coordinates), [nodes]);
  const { regionsByCode, points, onlinePoints } = useMemo(
    () => buildMapRegionSummary(signature, coordinates),
    [signature],
  );

  return (
    <div
      ref={containerRef}
      className="home-map-background"
      data-paused={active ? undefined : "true"}
      data-hover-enabled={hoverEnabled ? "true" : undefined}
    >
      <svg
        viewBox="0 0 1000 420"
        role="img"
        aria-label="节点地区分布地图"
        onPointerEnter={updateHoverInput}
        onPointerMove={updateHoverInput}
        onPointerDown={updateHoverInput}
        onPointerLeave={() => setHoverEnabled(false)}
        onPointerCancel={() => setHoverEnabled(false)}
      >
        <CountryShapes regionsByCode={regionsByCode} />
        <NodeMapMeteors points={onlinePoints} active={active} />
        {points.map((point, index) => (
          <g
            key={point.code}
            transform={`translate(${point.x} ${point.y})`}
            className="node-map-point"
            data-status={point.status}
          >
            <title>{`${point.label}：${point.total} 台，${point.online} 在线，${point.offline} 离线`}</title>
            <circle className="node-map-point-hit" r={6} aria-hidden="true" />
            <circle
              className="node-map-point-pulse"
              r={5}
              style={{ animationDelay: `${-index * 0.37}s` }}
              aria-hidden="true"
            />
            <circle className="node-map-point-core" r={5} />
          </g>
        ))}
      </svg>
    </div>
  );
}
