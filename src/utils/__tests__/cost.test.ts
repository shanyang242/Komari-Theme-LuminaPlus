import { describe, expect, it } from "vitest";
import { calculateCostSummary } from "@/utils/cost";
import type { NodeInfo } from "@/types/komari";

const RATES = { USD: 1, CNY: 7 };

function node(overrides: Record<string, unknown>): NodeInfo {
  return {
    uuid: "u1",
    name: "node",
    weight: 0,
    price: 0,
    currency: "USD",
    billing_cycle: 30,
    expired_at: "",
    ...overrides,
  } as unknown as NodeInfo;
}

function inDays(days: number) {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

describe("calculateCostSummary", () => {
  it("scales remaining value by prepaid cycles (price is per-cycle)", () => {
    // 10 USD (=70 CNY) per 30-day cycle, paid through ~1 year out → ~12 cycles
    // of prepaid value remaining. `price` is the per-cycle cost (confirmed by the
    // backend Client model + auto-renewal logic), so remaining must scale up.
    const summary = calculateCostSummary(
      [node({ price: 10, currency: "USD", billing_cycle: 30, expired_at: inDays(360) })],
      [],
      RATES,
    );
    expect(summary.paidCount).toBe(1);
    // 70 CNY/cycle × (360 days / 30 days) = ~840 CNY.
    expect(summary.remainingCny).toBeGreaterThan(70 * 11);
    expect(summary.remainingCny).toBeLessThan(70 * 13);
  });

  it("reports one cycle of value for long-term (>100y) nodes", () => {
    const summary = calculateCostSummary(
      [node({ price: 10, currency: "USD", billing_cycle: 30, expired_at: inDays(365 * 200) })],
      [],
      RATES,
    );
    expect(summary.remainingCny).toBeCloseTo(70, 5);
  });

  it("counts free nodes separately and excludes them from totals", () => {
    const summary = calculateCostSummary(
      [node({ uuid: "free", price: 0 })],
      [],
      RATES,
    );
    expect(summary.freeCount).toBe(1);
    expect(summary.paidCount).toBe(0);
    expect(summary.totalCny).toBe(0);
  });

  it("honours the ignored-node list", () => {
    const summary = calculateCostSummary(
      [node({ uuid: "skip", name: "ignored-box", price: 10, expired_at: inDays(10) })],
      ["ignored-box"],
      RATES,
    );
    expect(summary.ignoredCount).toBe(1);
    expect(summary.paidCount).toBe(0);
  });

  it("converts currency into CNY for the total", () => {
    const summary = calculateCostSummary(
      [node({ price: 10, currency: "USD", billing_cycle: 365, expired_at: inDays(200) })],
      [],
      RATES,
    );
    expect(summary.totalCny).toBeCloseTo(70, 5);
  });
});
