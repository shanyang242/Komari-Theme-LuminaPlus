import { describe, expect, it } from "vitest";
import { resolveLoadRecordTotals } from "@/utils/loadMetrics";

describe("resolveLoadRecordTotals", () => {
  it("uses node totals when the record omits them", () => {
    expect(resolveLoadRecordTotals(
      { ram_total: 0, swap_total: 0, disk_total: 0 },
      { ramTotal: 1024, swapTotal: 2048, diskTotal: 4096 },
    )).toEqual({ ramTotal: 1024, swapTotal: 2048, diskTotal: 4096 });
  });

  it("uses recorded totals when present", () => {
    expect(resolveLoadRecordTotals(
      { ram_total: 512, swap_total: 1024, disk_total: 2048 },
      { ramTotal: 4096, swapTotal: 4096, diskTotal: 4096 },
    )).toEqual({ ramTotal: 512, swapTotal: 1024, diskTotal: 2048 });
  });
});
