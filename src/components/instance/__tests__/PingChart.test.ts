import { describe, expect, it } from "vitest";
import { summarizePingRecords } from "@/components/instance/PingChart";

describe("summarizePingRecords", () => {
  it("summarizes raw ping records from the modified backend", () => {
    const summary = summarizePingRecords([
      { task_id: 1, client: "node-a", time: "2026-01-01T00:00:00Z", value: 10 },
      { task_id: 1, client: "node-a", time: "2026-01-01T00:01:00Z", value: 100 },
      { task_id: 1, client: "node-a", time: "2026-01-01T00:02:00Z", value: -1 },
    ]);

    expect(summary).toMatchObject({
      latest: 100,
      min: 10,
      max: 100,
      p50: 55,
      total: 3,
      lost: 1,
    });
    expect(summary.avg).toBe(55);
    expect(summary.p99).toBeCloseTo(99.1, 8);
    expect(summary.loss).toBeCloseTo(100 / 3, 8);
  });
});
