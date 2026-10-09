export interface TrafficDisplay {
  fraction: number;
  color: string;
  remainingLabel: string;
  detail: string;
  typeLabel: string;
}

interface TrafficUsage {
  used: number;
  limit: number;
  unlimited: boolean;
  remaining: number;
  fraction: number;
}

// 首页卡片与实例详情共用同一归约口径。
export function resolveTrafficUsage(
  limit: number,
  effectiveUsed: number,
): TrafficUsage {
  const used = Number.isFinite(effectiveUsed) ? Math.max(0, effectiveUsed) : 0;
  const unlimited = !(limit > 0);
  const remaining = unlimited ? 0 : Math.max(0, limit - used);
  const fraction = unlimited ? 0 : Math.max(0, Math.min(1, used / limit));
  return { used, limit, unlimited, remaining, fraction };
}

export function trafficTypeLabel(type: string | null | undefined): string {
  switch ((type ?? "").trim().toLowerCase()) {
    case "up":
      return "仅上行";
    case "down":
      return "仅下行";
    case "sum":
      return "上行+下行";
    case "min":
      return "上下取小";
    case "max":
    default:
      return "上下取大";
  }
}
