const UNITS = ["B", "KB", "MB", "GB", "TB", "PB"] as const;
const TRAFFIC_RATE_THRESHOLDS: Array<{ unit: Exclude<TrafficRateUnit, "bps">; divisor: number }> = [
  { unit: "Tbps", divisor: 1_000_000_000_000 },
  { unit: "Gbps", divisor: 1_000_000_000 },
  { unit: "Mbps", divisor: 1_000_000 },
  { unit: "Kbps", divisor: 1_000 },
];

type ExpireTone = "ok" | "warn" | "critical" | "long" | "none";
export type TrafficRateUnit = "bps" | "Kbps" | "Mbps" | "Gbps" | "Tbps";

export interface TrafficRateDisplay {
  value: string;
  unit: TrafficRateUnit;
  bitsPerSec: number;
}

export function trimFixed(value: number, digits: number): string {
  return value
    .toFixed(digits)
    .replace(/\.0+$/, "")
    .replace(/(\.\d*?[1-9])0+$/, "$1");
}

export function joinDisplayParts(parts: Array<string | null | undefined>) {
  return parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(" · ");
}

export function formatBytes(n: number | undefined | null, decimals = 2): string {
  if (!n || n < 0) return "0 B";
  let idx = 0;
  let v = n;
  while (v >= 1024 && idx < UNITS.length - 1) {
    v /= 1024;
    idx += 1;
  }
  if (idx === 0) return `${Math.round(v)} ${UNITS[idx]}`;
  const dec = v >= 100 ? 0 : v >= 10 ? 1 : decimals;
  return `${v.toFixed(dec)} ${UNITS[idx]}`;
}

function formatRateValue(value: number): string {
  if (value >= 100) return Math.round(value).toString();
  if (value >= 10) return trimFixed(value, 1);
  if (value >= 1) return trimFixed(value, 2);
  return trimFixed(value, 3);
}

export function formatTrafficRate(bytesPerSec: number | undefined | null): TrafficRateDisplay {
  if (!bytesPerSec || !Number.isFinite(bytesPerSec) || bytesPerSec <= 0) {
    return {
      value: "0",
      unit: "bps",
      bitsPerSec: 0,
    };
  }

  const bitsPerSec = bytesPerSec * 8;
  for (const { unit, divisor } of TRAFFIC_RATE_THRESHOLDS) {
    if (bitsPerSec >= divisor) {
      return {
        value: formatRateValue(bitsPerSec / divisor),
        unit,
        bitsPerSec,
      };
    }
  }

  return {
    value: bitsPerSec >= 100 ? Math.round(bitsPerSec).toString() : trimFixed(bitsPerSec, 1),
    unit: "bps",
    bitsPerSec,
  };
}

export function formatTrafficRateLabel(bytesPerSec: number | undefined | null): string {
  const rate = formatTrafficRate(bytesPerSec);
  return `${rate.value} ${rate.unit}`;
}

export function formatUptimeDays(seconds: number): { value: string; unit: string } {
  if (!seconds || seconds <= 0) return { value: "—", unit: "" };
  const days = seconds / 86400;
  if (days >= 1) return { value: Math.floor(days).toString(), unit: "天" };
  const hours = seconds / 3600;
  if (hours >= 1) return { value: Math.floor(hours).toString(), unit: "小时" };
  const minutes = seconds / 60;
  return { value: Math.floor(minutes).toString(), unit: "分钟" };
}

export function formatOfflineDuration(
  updatedAt: number | undefined | null,
): { value: string; unit: string; full: string } {
  if (!updatedAt || !Number.isFinite(updatedAt) || updatedAt <= 0) {
    return { value: "未知", unit: "", full: "离线时长未知" };
  }

  const diffMs = Math.max(0, Date.now() - updatedAt);
  const minutes = Math.floor(diffMs / 60000);

  if (minutes < 1) {
    return { value: "刚刚", unit: "", full: "刚刚离线" };
  }

  if (minutes < 60) {
    return { value: String(minutes), unit: "分钟", full: `离线 ${minutes} 分钟` };
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return { value: String(hours), unit: "小时", full: `离线 ${hours} 小时` };
  }

  const days = Math.floor(hours / 24);
  return { value: String(days), unit: "天", full: `离线 ${days} 天` };
}

export function getExpireDaysRemaining(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return null;
  return Math.floor((ts - Date.now()) / 86400000);
}

function resolveExpireTone(days: number | null | undefined): ExpireTone {
  if (days == null || !Number.isFinite(days)) return "none";
  if (days > 36500) return "long";
  if (days > 30) return "ok";
  if (days > 7) return "warn";
  return "critical";
}

export function formatExpireDays(iso: string | null | undefined): { value: string; unit: string; tone: ExpireTone } {
  const days = getExpireDaysRemaining(iso);
  const tone = resolveExpireTone(days);
  if (days == null) return { value: "—", unit: "", tone };
  if (tone === "long") return { value: "长期", unit: "", tone };
  if (tone === "ok" || tone === "warn") return { value: days.toString(), unit: "天", tone };
  if (days > 0) return { value: days.toString(), unit: "天", tone };
  if (days === 0) return { value: "今日", unit: "", tone };
  return { value: "已过期", unit: "", tone };
}

function inferPlainTagColor(label: string): string {
  const normalized = label.trim().toLowerCase();

  if (/(cn2gia|9929|cmin2)/i.test(normalized)) {
    return "blue";
  }

  if (/(163pp|163|4837|cmi)/i.test(normalized)) {
    return "green";
  }

  return "violet";
}

/** Parse `tag1<color>;tag2<color2>` into [{ label, color }]. */
export function parseTags(raw: string | undefined | null): Array<{ label: string; color: string }> {
  if (!raw) return [];
  return raw
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((item) => {
      const m = item.match(/^(.*?)<([a-zA-Z]+)>$/);
      if (m) return { label: m[1].trim(), color: m[2].toLowerCase() };
      return { label: item, color: inferPlainTagColor(item) };
    });
}
