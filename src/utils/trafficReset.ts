import { LONG_TERM_EXPIRE_DAYS, resolveExpireTimestamp } from "@/utils/format";

export interface TrafficResetDisplay {
  label: string;
  title: string;
}

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

function explicitShanghaiResetDisplay(resetDay: number, now: number): TrafficResetDisplay | null {
  if (!Number.isFinite(now)) return null;
  const shifted = new Date(now + SHANGHAI_OFFSET_MS);
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth();
  const todayDay = shifted.getUTCDate();
  const monthlyDate = (monthIndex: number) => {
    const normalized = new Date(Date.UTC(year, monthIndex, 1));
    const targetYear = normalized.getUTCFullYear();
    const targetMonth = normalized.getUTCMonth();
    const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
    return {
      year: targetYear,
      month: targetMonth,
      day: Math.min(resetDay, lastDay),
    };
  };

  let next = monthlyDate(month);
  if (next.day < todayDay) next = monthlyDate(month + 1);
  const todayOrdinal = Date.UTC(year, month, todayDay);
  const nextOrdinal = Date.UTC(next.year, next.month, next.day);
  const days = (nextOrdinal - todayOrdinal) / 86_400_000;
  const dateLabel = `${next.year}-${String(next.month + 1).padStart(2, "0")}-${String(next.day).padStart(2, "0")}`;
  return {
    label: days === 0 ? "今日重置" : `${days}天后重置`,
    title: `流量重置日：${dateLabel} · 后台设置，每月${resetDay}日重置（不足该日取月末，Asia/Shanghai）`,
  };
}

/**
 * 新后端提供 1-31 时固定按 Asia/Shanghai 计算；字段缺失或为 0 时，
 * 完整保留原先按到期日和浏览器时区推导的兼容逻辑。
 */
export function getTrafficResetDisplay(
  expiredAt: string | number | null | undefined,
  now: number,
  trafficResetDay?: number | null,
): TrafficResetDisplay | null {
  if (
    trafficResetDay != null &&
    Number.isInteger(trafficResetDay) &&
    trafficResetDay >= 1 &&
    trafficResetDay <= 31
  ) {
    return explicitShanghaiResetDisplay(trafficResetDay, now);
  }

  const timestamp = resolveExpireTimestamp(expiredAt);
  if (timestamp == null || !Number.isFinite(now)) return null;
  if ((timestamp - now) / 86_400_000 > LONG_TERM_EXPIRE_DAYS) return null;

  const day = new Date(timestamp).getDate();
  const today = new Date(now);
  const year = today.getFullYear();
  const month = today.getMonth();
  const monthlyDate = (monthIndex: number) =>
    new Date(year, monthIndex, Math.min(day, new Date(year, monthIndex + 1, 0).getDate()));
  let next = monthlyDate(month);
  // 当天整天显示“今日重置”，次日再滚动至下一月。
  if (next.getDate() < today.getDate()) next = monthlyDate(month + 1);
  // 用日历日计算，避免夏令时切换造成 23/25 小时的一天被取整错算。
  const ordinal = (date: Date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const days = (ordinal(next) - ordinal(today)) / 86_400_000;
  const dateLabel = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`;
  return {
    label: days === 0 ? "今日重置" : `${days}天后重置`,
    title: `流量重置日：${dateLabel} · 默认按到期日，每月${day}日重置（不足该日取月末）`,
  };
}
