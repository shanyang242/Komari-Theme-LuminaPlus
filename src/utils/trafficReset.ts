import { LONG_TERM_EXPIRE_DAYS, resolveExpireTimestamp } from "@/utils/format";

export interface TrafficResetDisplay {
  label: string;
  title: string;
}

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

function computeNextMonthlyReset(
  year: number,
  month: number,
  todayDay: number,
  resetDay: number,
) {
  const resolveMonth = (monthIndex: number) => {
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

  // 走 UTC 日历日防夏令时偏差；当天显示今日重置，次日滚至下月
  let next = resolveMonth(month);
  if (next.day < todayDay) next = resolveMonth(month + 1);
  const days =
    (Date.UTC(next.year, next.month, next.day) - Date.UTC(year, month, todayDay)) / 86_400_000;
  const dateLabel = `${next.year}-${String(next.month + 1).padStart(2, "0")}-${String(next.day).padStart(2, "0")}`;

  return {
    label: days === 0 ? "今日重置" : `${days}天后重置`,
    dateLabel,
  };
}

/** 1–31 按 Asia/Shanghai 计算；0 按到期日推导每月重置日。 */
export function getTrafficResetDisplay(
  expiredAt: string | number | null | undefined,
  now: number,
  trafficResetDay?: number | null,
): TrafficResetDisplay | null {
  if (!Number.isFinite(now)) return null;

  if (
    trafficResetDay != null &&
    Number.isInteger(trafficResetDay) &&
    trafficResetDay >= 1 &&
    trafficResetDay <= 31
  ) {
    const shifted = new Date(now + SHANGHAI_OFFSET_MS);
    const { label, dateLabel } = computeNextMonthlyReset(
      shifted.getUTCFullYear(),
      shifted.getUTCMonth(),
      shifted.getUTCDate(),
      trafficResetDay,
    );
    return {
      label,
      title: `流量重置日：${dateLabel} · 后台设置，每月${trafficResetDay}日重置（不足该日取月末，Asia/Shanghai）`,
    };
  }

  const timestamp = resolveExpireTimestamp(expiredAt);
  if (timestamp == null) return null;
  if ((timestamp - now) / 86_400_000 > LONG_TERM_EXPIRE_DAYS) return null;

  const resetDay = new Date(timestamp).getDate();
  const today = new Date(now);
  const { label, dateLabel } = computeNextMonthlyReset(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
    resetDay,
  );
  return {
    label,
    title: `流量重置日：${dateLabel} · 默认按到期日，每月${resetDay}日重置（不足该日取月末）`,
  };
}
