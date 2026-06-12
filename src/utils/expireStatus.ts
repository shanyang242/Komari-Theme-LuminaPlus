import { getExpireDaysRemaining } from "@/utils/format";
import { clamp, toHsl } from "@/utils/hsl";

const EXPIRE_FULL_DAYS = 180;

function expireHeatColor(daysRemaining: number): string {
  if (daysRemaining > 36500) {
    return "var(--status-success)";
  }

  if (daysRemaining <= 0) {
    return toHsl(6, 84, 53);
  }

  if (daysRemaining <= 7) {
    const t = clamp(daysRemaining / 7, 0, 1);
    return toHsl(8 + 24 * t, 84 - 4 * t, 53 - 1 * t);
  }

  if (daysRemaining <= 30) {
    const t = clamp((daysRemaining - 7) / 23, 0, 1);
    return toHsl(32 + 18 * t, 80 - 4 * t, 52);
  }

  const t = clamp((Math.min(daysRemaining, EXPIRE_FULL_DAYS) - 30) / (EXPIRE_FULL_DAYS - 30), 0, 1);
  return toHsl(50 + 94 * t, 76 - 10 * t, 52 - 4 * t);
}

export function getExpireTextColor(iso: string | null | undefined): string {
  const daysRemaining = getExpireDaysRemaining(iso);
  if (daysRemaining == null) return "var(--text-tertiary)";
  return expireHeatColor(daysRemaining);
}
