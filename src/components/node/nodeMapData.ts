import { getCountryCodeFromRegion } from "@/utils/geo";

type MapStatus = "online" | "offline" | "unknown";

export interface MapNodeInput {
  region: string;
  online: boolean | null;
}

export interface MapRegionStats {
  total: number;
  online: number;
  offline: number;
}

export interface MapPointPosition {
  code: string;
  x: number;
  y: number;
}

type MapPointItem = MapRegionStats & MapPointPosition & {
  label: string;
  status: MapStatus;
};

type MapRegionSummary = {
  regionsByCode: Map<string, MapRegionStats>;
  points: MapPointItem[];
  onlinePoints: MapPointItem[];
};

export interface MeteorRouteGeometry {
  path: string;
  maskX: number;
  maskY: number;
  maskWidth: number;
  maskHeight: number;
}

const MASK_STROKE_PADDING = 8;
/** 近邻标记最小中心距（命中圆半径 6）。 */
export const MIN_POINT_SEPARATION = 12;
const VIEWBOX_MIN_X = 8;
const VIEWBOX_MAX_X = 992;
const VIEWBOX_MIN_Y = 8;
const VIEWBOX_MAX_Y = 412;
const RELAXATION_PASSES = 6;

/** 补充 world-map.json 未内置的泛区域坐标。 */
export const EXTRA_MAP_POINTS: Record<string, readonly [number, number]> = {
  EU: [520.5, 99.5],
};

let regionDisplayNames: Intl.DisplayNames | null | undefined;
const regionLabelCache = new Map<string, string>();

function getRegionDisplayNamesInstance(): Intl.DisplayNames | null {
  if (regionDisplayNames !== undefined) return regionDisplayNames;
  try {
    regionDisplayNames =
      typeof Intl !== "undefined" && typeof Intl.DisplayNames === "function"
        ? new Intl.DisplayNames(["zh-Hans"], { type: "region" })
        : null;
  } catch {
    regionDisplayNames = null;
  }
  return regionDisplayNames;
}

function round1(value: number): number {
  const rounded = Math.round(value * 10) / 10;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function getRegionDisplayName(code: string, fallbackName = ""): string {
  const normalizedCode = code.trim();
  const normalizedFallback = fallbackName.trim();
  if (!normalizedCode && !normalizedFallback) return "";

  const cacheKey = `${normalizedCode}|${normalizedFallback}`;
  const cached = regionLabelCache.get(cacheKey);
  if (cached !== undefined) return cached;

  let resolved = normalizedFallback || normalizedCode;
  if (/^[A-Z]{2}$/.test(normalizedCode)) {
    try {
      const localized = getRegionDisplayNamesInstance()?.of(normalizedCode)?.trim();
      if (localized) resolved = localized;
    } catch {
      // 非标准地区码回退原始值
    }
  }

  regionLabelCache.set(cacheKey, resolved);
  return resolved;
}

export function getCountryMapStatus(region: MapRegionStats | undefined): MapStatus | undefined {
  if (!region) return undefined;
  if (region.online > 0) return "online";
  if (region.offline > 0) return "offline";
  return "unknown";
}

export function getPointMapStatus(region: MapRegionStats): MapStatus {
  if (region.offline > 0) return "offline";
  if (region.online > 0) return "online";
  return "unknown";
}

export function buildMapSignature(
  nodes: ReadonlyArray<MapNodeInput>,
  coordinates: Record<string, readonly number[]>,
): string {
  if (nodes.length === 0) return "";
  const byRegion = new Map<string, MapRegionStats>();
  for (const { region, online } of nodes) {
    const code = getCountryCodeFromRegion(region);
    if (!code) continue;
    const point = coordinates[code];
    if (!point || point.length < 2) continue;
    const stats = byRegion.get(code) ?? { total: 0, online: 0, offline: 0 };
    stats.total += 1;
    if (online === true) stats.online += 1;
    else if (online === false) stats.offline += 1;
    byRegion.set(code, stats);
  }
  if (byRegion.size === 0) return "";

  return Array.from(byRegion.keys())
    .sort()
    .map((code) => {
      const stats = byRegion.get(code)!;
      return `${code}:${stats.total}:${stats.online}:${stats.offline}`;
    })
    .join(",");
}

/** 对近邻标记做确定性微偏移，避免重叠遮挡。 */
export function resolveMapPointPositions<T extends MapPointPosition>(
  items: ReadonlyArray<T>,
  minDistance = MIN_POINT_SEPARATION,
): T[] {
  const result = items.map((item) => ({ ...item }));
  if (result.length < 2) return result;

  for (let pass = 0; pass < RELAXATION_PASSES; pass += 1) {
    let moved = false;
    for (let i = 0; i < result.length; i += 1) {
      for (let j = i + 1; j < result.length; j += 1) {
        const a = result[i];
        const b = result[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distance = Math.hypot(dx, dy);
        if (distance >= minDistance) continue;

        moved = true;
        let ux: number;
        let uy: number;
        if (distance > 0.01) {
          ux = dx / distance;
          uy = dy / distance;
        } else {
          const angle = (j - i) * 1.1;
          ux = Math.cos(angle);
          uy = Math.sin(angle);
        }
        const push = (minDistance - distance) * 0.5;
        a.x = clamp(a.x - ux * push, VIEWBOX_MIN_X, VIEWBOX_MAX_X);
        a.y = clamp(a.y - uy * push, VIEWBOX_MIN_Y, VIEWBOX_MAX_Y);
        b.x = clamp(b.x + ux * push, VIEWBOX_MIN_X, VIEWBOX_MAX_X);
        b.y = clamp(b.y + uy * push, VIEWBOX_MIN_Y, VIEWBOX_MAX_Y);
      }
    }
    if (!moved) break;
  }

  for (const item of result) {
    item.x = round1(item.x);
    item.y = round1(item.y);
  }
  return result;
}

export function buildMapRegionSummary(
  signature: string,
  coordinates: Record<string, readonly number[]>,
): MapRegionSummary {
  const regionsByCode = new Map<string, MapRegionStats>();
  if (!signature) {
    return {
      regionsByCode,
      points: [],
      onlinePoints: [],
    };
  }

  const rawPoints: MapPointItem[] = [];

  for (const entry of signature.split(",")) {
    const [code, totalRaw, onlineRaw, offlineRaw] = entry.split(":");
    if (!code) continue;
    const point = coordinates[code];
    if (!point || point.length < 2) continue;

    const total = Number(totalRaw);
    const online = Number(onlineRaw);
    const offline = Number(offlineRaw);
    if (!Number.isFinite(total) || total <= 0) continue;

    const stats: MapRegionStats = {
      total,
      online: Number.isFinite(online) ? online : 0,
      offline: Number.isFinite(offline) ? offline : 0,
    };
    regionsByCode.set(code, stats);

    const [x, y] = point;
    rawPoints.push({
      code,
      label: getRegionDisplayName(code),
      x,
      y,
      total: stats.total,
      online: stats.online,
      offline: stats.offline,
      status: getPointMapStatus(stats),
    });
  }

  const points = resolveMapPointPositions(rawPoints);
  return {
    regionsByCode,
    points,
    onlinePoints: points.filter((point) => point.online > 0),
  };
}

/** 计算航线贝塞尔路径及局部遮罩包围盒。 */
export function buildMeteorRoute(
  from: readonly number[],
  to: readonly number[],
): MeteorRouteGeometry | null {
  if (from.length < 2 || to.length < 2) return null;
  const [x1, y1] = from;
  const [x2, y2] = to;
  const distance = Math.hypot(x2 - x1, y2 - y1);
  if (!Number.isFinite(distance) || distance < 1) return null;

  const bend = Math.min(65, distance * 0.2);
  const cx = round1((x1 + x2) / 2);
  const cy = round1((y1 + y2) / 2 - bend);
  const sx = round1(x1);
  const sy = round1(y1);
  const ex = round1(x2);
  const ey = round1(y2);

  const maskX = Math.floor(Math.min(sx, ex, cx) - MASK_STROKE_PADDING);
  const maskY = Math.floor(Math.min(sy, ey, cy) - MASK_STROKE_PADDING);
  const maskWidth = Math.max(1, Math.ceil(Math.max(sx, ex, cx) + MASK_STROKE_PADDING) - maskX);
  const maskHeight = Math.max(1, Math.ceil(Math.max(sy, ey, cy) + MASK_STROKE_PADDING) - maskY);

  return {
    path: `M ${sx} ${sy} Q ${cx} ${cy} ${ex} ${ey}`,
    maskX,
    maskY,
    maskWidth,
    maskHeight,
  };
}
