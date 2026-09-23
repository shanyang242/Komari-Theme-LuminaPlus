import type { LoadRecord } from "@/types/komari";

export interface LoadRecordTotalFallbacks {
  ramTotal?: number;
  swapTotal?: number;
  diskTotal?: number;
}

export interface ResolvedLoadRecordTotals {
  ramTotal: number;
  swapTotal: number;
  diskTotal: number;
}

function nonNegativeFinite(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/** 历史记录缺少资源总量时，使用节点当前的基础信息。 */
export function resolveLoadRecordTotals(
  record: Pick<LoadRecord, "ram_total" | "swap_total" | "disk_total">,
  fallbacks: LoadRecordTotalFallbacks = {},
): ResolvedLoadRecordTotals {
  return {
    ramTotal: nonNegativeFinite(record.ram_total) || nonNegativeFinite(fallbacks.ramTotal),
    swapTotal: nonNegativeFinite(record.swap_total) || nonNegativeFinite(fallbacks.swapTotal),
    diskTotal: nonNegativeFinite(record.disk_total) || nonNegativeFinite(fallbacks.diskTotal),
  };
}
