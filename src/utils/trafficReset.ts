import { LONG_TERM_EXPIRE_DAYS, resolveExpireTimestamp } from "@/utils/format";

export interface TrafficResetDisplay {
  label: string;
  title: string;
  day: number;
  date: string;
}

function isResetDay(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 31;
}

export function normalizeTrafficResetDays(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  // 固定键序，避免同一份配置因编辑顺序不同被误判为未保存。
  return Object.fromEntries(
    Object.entries(value)
      .filter(([uuid, day]) => uuid.trim() !== "" && isResetDay(day))
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

/** 与到期日期展示使用同一浏览器时区；只推导月度计划，不改变流量计数。 */
export function getTrafficResetDisplay(
  expiredAt: string | number | null | undefined,
  now: number,
  customDay?: number,
): TrafficResetDisplay | null {
  if (!Number.isFinite(now)) return null;
  const custom = isResetDay(customDay);
  let day: number;
  if (custom) {
    day = customDay;
  } else {
    const timestamp = resolveExpireTimestamp(expiredAt);
    if (timestamp == null || (timestamp - now) / 86_400_000 > LONG_TERM_EXPIRE_DAYS) return null;
    day = new Date(timestamp).getDate();
  }

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
    day,
    date: dateLabel,
    label: days === 0 ? "今日重置" : `${days}天后重置`,
    title: `流量重置日：${dateLabel} · ${custom ? "自定义" : "默认按到期日"}，每月${day}日重置（不足该日取月末）`,
  };
}
