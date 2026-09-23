// 大卡与紧凑卡共享的格式化和命中逻辑。

import { formatUptimeDays, trimFixed } from "@/utils/format";
import { latencyHeatColor, lossHeatColor } from "@/utils/metricTone";
import type { PingOverviewBucket } from "@/types/komari";

/** 卡片标签行的完整 tag 列表 tooltip(几种卡片布局共用同一文案)。 */
export function joinTagTitle(tags: { label: string }[]) {
  return tags.map((tag) => tag.label).join(" / ");
}

/** ≥10% 取整，否则保留一位小数。 */
export function formatCompactPercent(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0%";
  if (value >= 10) return `${Math.round(value)}%`;
  return `${trimFixed(value, 1)}%`;
}

/** 卡片到期文案:"余 X天";无到期时 "余 --"。 */
export function formatCompactExpire({ value, unit }: { value: string; unit: string }) {
  if (value === "—") return "余 --";
  return unit ? `余 ${value}${unit}` : value;
}

/** 非法或非正时长返回空串。 */
export function formatCompactUptime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  const uptime = formatUptimeDays(seconds);
  return `在线：${uptime.value}${uptime.unit}`;
}

/** 区分已绑定但无样本与未配置 Ping。 */
export function pingEmptyLabels(
  hasHomepagePingBinding: boolean,
  pingLoading = false,
  pingError = false,
): { title: string; text: string } {
  if (hasHomepagePingBinding && pingLoading) {
    return { title: "正在加载首页 Ping", text: "加载中" };
  }
  if (hasHomepagePingBinding && pingError) {
    return { title: "首页 Ping 加载失败", text: "加载失败" };
  }
  return hasHomepagePingBinding
    ? { title: "暂无有效样本", text: "无样本" }
    : { title: "未配置首页 Ping", text: "未配置" };
}

/** 生成“Debian 12”这类简短系统标签。 */
export function formatOsLabel(osName: string, rawOs?: string | null): string {
  if (!rawOs) return osName;
  const match = rawOs.match(/\d+(?:\.\d+)?/);
  return match ? `${osName} ${match[0]}` : osName;
}

/** 节点卡片头部"查看实例详情"链接的 title 和 aria-label。 */
export function nodeDetailLinkLabels(name: string, osName: string) {
  return {
    title: `${osName} · 查看详情`,
    ariaLabel: `查看 ${name} 详情，系统 ${osName}`,
  };
}

/** 极小但非零流量只显示一段内的细提示，避免夸大用量。 */
export const TRAFFIC_SLIVER_RATIO = 0.1;

// LatencyBars(延迟)和 QualityBars(丢包)共享的柱状条几何/命中检测。两者都渲染
// 定数量的 canvas 柱子行,所以 slot 计算和柱宽/间距必须保持一致。

/** 指针 offset 落在哪个 slot(0..count-1),没有柱子时返回 null。 */
export function getBarSlot(offsetX: number, width: number, count: number): number | null {
  if (count === 0 || width <= 0) return null;
  const slotWidth = width / count;
  return Math.max(0, Math.min(count - 1, Math.floor(offsetX / slotWidth)));
}

/** 跨 `width` px、含 `count` 根柱子的条形,每根柱宽和柱间间距。 */
export function getBarGeometry(width: number, count: number): { gap: number; barWidth: number } {
  const gap = count > 48 ? 1 : 2;
  const barWidth = Math.max(1, (width - gap * (count - 1)) / Math.max(1, count));
  return { gap, barWidth };
}

// 延迟/丢包柱的统一取值模型:激活判定/柱高/颜色/透明度只在这一处定义，
// 由大卡 Canvas 与小卡 DOM 共同使用。
// 延迟与丢包都使用固定高度，严重度只由绝对值颜色表达，便于跨节点比较。
export interface HealthBarSlotModel {
  active: boolean;
  /** 柱高占比(0-1)。 */
  heightFraction: number;
  /** CSS 颜色;canvas 侧需再经 safeCanvasColor 解析。 */
  color: string;
  alpha: number;
}

/** DOM、SVG 与 Canvas 统一采用 1.55 倍抬高和 54% 背景透明度。 */
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
