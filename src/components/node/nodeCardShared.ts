import { formatUptimeDays, trimFixed } from "@/utils/format";
import { latencyHeatColor, lossHeatColor } from "@/utils/metricTone";
import type { PingOverviewBucket } from "@/types/komari";

export function joinTagTitle(tags: { label: string }[]) {
  return tags.map((tag) => tag.label).join(" / ");
}

export function formatCompactPercent(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0%";
  if (value >= 10) return `${Math.round(value)}%`;
  return `${trimFixed(value, 1)}%`;
}

export function formatCompactExpire({ value, unit }: { value: string; unit: string }) {
  if (value === "—") return "余 --";
  return unit ? `余 ${value}${unit}` : value;
}

export function formatCompactUptime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  const uptime = formatUptimeDays(seconds);
  return `在线：${uptime.value}${uptime.unit}`;
}

export function pingEmptyLabels(
  isPingAssigned: boolean,
  pingLoading = false,
  pingError = false,
): { title: string; text: string } {
  if (isPingAssigned && pingLoading) {
    return { title: "正在加载首页 Ping", text: "加载中" };
  }
  if (isPingAssigned && pingError) {
    return { title: "首页 Ping 加载失败", text: "加载失败" };
  }
  return isPingAssigned
    ? { title: "暂无有效样本", text: "无样本" }
    : { title: "未配置首页 Ping", text: "未配置" };
}

export function nodeDetailLinkLabels(name: string, osName: string) {
  return {
    title: `${osName} · 查看详情`,
    ariaLabel: `查看 ${name} 详情，系统 ${osName}`,
  };
}

/** 极小非零流量的段内细边占比。 */
export const TRAFFIC_SLIVER_RATIO = 0.1;

export function getBarSlot(offsetX: number, width: number, count: number): number | null {
  if (count === 0 || width <= 0) return null;
  const slotWidth = width / count;
  return Math.max(0, Math.min(count - 1, Math.floor(offsetX / slotWidth)));
}

export function getBarGeometry(width: number, count: number): { gap: number; barWidth: number } {
  const gap = count > 48 ? 1 : 2;
  const barWidth = Math.max(1, (width - gap * (count - 1)) / Math.max(1, count));
  return { gap, barWidth };
}

// 延迟/丢包柱统一取固定高度，严重度由颜色表达
interface HealthBarSlotModel {
  active: boolean;
  heightFraction: number;
  color: string;
  alpha: number;
}

export function healthBarInteractionModel(
  slot: HealthBarSlotModel,
  isHovered: boolean,
  hoverProgress: number,
) {
  const progress = Math.max(0, Math.min(1, hoverProgress));
  if (isHovered) {
    return {
      heightFraction: Math.min(1, slot.heightFraction * (1 + 0.55 * progress)),
      alpha: slot.alpha + (1 - slot.alpha) * progress,
    };
  }
  return {
    heightFraction: slot.heightFraction,
    alpha: slot.alpha * (1 - 0.46 * progress),
  };
}

const HEALTH_LOSS_BAR_HEIGHT = 0.84;
const HEALTH_INACTIVE_BAR_HEIGHT = 0.25;

export function healthBarSlotModel(
  bucket: PingOverviewBucket,
  kind: "latency" | "loss",
): HealthBarSlotModel {
  if (kind === "latency") {
    const value = bucket.value;
    if (value != null && Number.isFinite(value) && value >= 0) {
      return {
        active: true,
        heightFraction: HEALTH_LOSS_BAR_HEIGHT,
        color: latencyHeatColor(value),
        alpha: 0.94,
      };
    }
    return {
      active: false,
      heightFraction: HEALTH_INACTIVE_BAR_HEIGHT,
      color: "var(--progress-bg)",
      alpha: 0.55,
    };
  }
  const loss = bucket.loss;
  if (loss != null && Number.isFinite(loss) && bucket.total > 0) {
    return {
      active: true,
      heightFraction: HEALTH_LOSS_BAR_HEIGHT,
      color: lossHeatColor(loss),
      alpha: 0.94,
    };
  }
  return {
    active: false,
    heightFraction: HEALTH_LOSS_BAR_HEIGHT,
    color: "var(--progress-bg)",
    alpha: 0.42,
  };
}
