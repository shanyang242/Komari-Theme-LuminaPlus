import { describe, expect, it } from "vitest";
import {
  buildLoadTimeRangeOptions,
  buildPingTimeRangeOptions,
} from "@/components/instance/chartShared";

describe("detail chart time ranges", () => {
  it("keeps Ping limited to 1h, 4h, 1d and 7d even with 90 days retained", () => {
    expect(buildPingTimeRangeOptions(90 * 24)).toEqual([
      { label: "1 小时", value: 1 },
      { label: "4 小时", value: 4 },
      { label: "1 天", value: 24 },
      { label: "7 天", value: 168 },
    ]);
  });

  it("keeps load history limited to one day even with 90 days retained", () => {
    expect(buildLoadTimeRangeOptions(90 * 24)).toEqual([
      { label: "实时", value: 0 },
      { label: "1 小时", value: 1 },
      { label: "4 小时", value: 4 },
      { label: "1 天", value: 24 },
    ]);
  });
});
