import { afterEach, describe, expect, it, vi } from "vitest";
import {
  calculateCostPremiumAmount,
  calculateCostPremiumBasisAt,
  calculateCostSummary,
  formatCnyMoney,
  getExchangeRates,
  isCostRateApiUrlValid,
  normalizeCostIgnoredNodes,
  normalizeCostPremiums,
  normalizeCostRateApiUrl,
  DEFAULT_COST_RATE_API_URL,
} from "@/utils/cost";
import type { NodeInfo } from "@/types/komari";

const RATES = { USD: 1, CNY: 7 };
const RATES_X = { USD: 1, EUR: 0.9, CNY: 7 };

afterEach(() => {
  vi.unstubAllGlobals();
});

// 分类计数器已从 CostSummary 移除(分类信息由 detail.note / detail.counted 承担),
// 测试改为直接从 details 派生数量。
type Summary = ReturnType<typeof calculateCostSummary>;
const paidCount = (s: Summary) => s.details.filter((d) => d.counted).length;
const noteCount = (s: Summary, note: string) => s.details.filter((d) => d.note === note).length;

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

function agoDays(days: number) {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

describe("calculateCostSummary", () => {
  it("scales remaining value by prepaid cycles (price is per-cycle)", () => {
    // 10 USD(=70 CNY)每 30 天一个周期,付到约 1 年后 → 还剩约 12 个周期的预付价值。
    // price 是每周期价格(后端 Client model + 自动续费逻辑已确认),所以剩余价值要按周期数放大
    const summary = calculateCostSummary(
      [node({ price: 10, currency: "USD", billing_cycle: 30, expired_at: inDays(360) })],
      [],
      RATES,
    );
    expect(paidCount(summary)).toBe(1);
    // 70 CNY/周期 × (360 天 / 30 天) ≈ 840 CNY
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

  it("counts a no-expiry node as one cycle of remaining value, not zero", () => {
    // 防回归:永不过期的节点(Go 零值时间 / 0 / -1 / 未设置)以前会被当成已过期,
    // 导致其预付价值被完全从剩余价值里漏掉
    for (const sentinel of ["0001-01-01T00:00:00Z", "0", "-1", ""]) {
      const summary = calculateCostSummary(
        [node({ price: 10, currency: "USD", billing_cycle: 30, expired_at: sentinel })],
        [],
        RATES,
      );
      expect(paidCount(summary)).toBe(1);
      // 10 USD × 7 = 70 CNY = 一个周期的价值(和 >100 年的长期节点一致)
      expect(summary.remainingCny).toBeCloseTo(70, 5);
    }
  });

  it("treats an unset currency as the target currency (CNY), not USD", () => {
    // 防回归:空 currency 以前默认按 USD 算,会把 CNY 定价的节点放大约 7 倍
    const summary = calculateCostSummary(
      [node({ price: 100, currency: "", billing_cycle: "monthly" })],
      [],
      RATES,
    );
    expect(noteCount(summary, "汇率缺失")).toBe(0);
    expect(summary.monthlyCny).toBeCloseTo(100, 6);
  });

  it("counts free nodes separately and excludes them from totals", () => {
    const summary = calculateCostSummary(
      [node({ uuid: "free", price: 0 })],
      [],
      RATES,
    );
    expect(noteCount(summary, "免费")).toBe(1);
    expect(paidCount(summary)).toBe(0);
    expect(summary.totalCny).toBe(0);
  });

  it("ignores only the next bill while retaining the current remaining value", () => {
    const summary = calculateCostSummary(
      [node({ uuid: "skip", name: "ignored-box", price: 10, expired_at: inDays(10) })],
      ["ignored-box"],
      RATES,
    );
    expect(noteCount(summary, "忽略下期账单")).toBe(1);
    expect(paidCount(summary)).toBe(1);
    expect(summary.totalCny).toBe(0);
    expect(summary.monthlyCny).toBe(0);
    expect(summary.remainingCny).toBeGreaterThan(0);
    expect(summary.details[0].billingIgnored).toBe(true);
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

describe("calculateCostSummary — acquisition premiums", () => {
  it("adds a paid node's premium to premiumTotalCny and its detail", () => {
    const summary = calculateCostSummary(
      [node({ uuid: "paid", price: 10, expired_at: inDays(10) })],
      [],
      RATES,
      { paid: { amount: 50 } },
    );
    expect(summary.premiumTotalCny).toBe(50);
    expect(summary.details[0].premiumCny).toBe(50);
  });

  it("keeps premiums for free nodes (premium is CNY, independent of price)", () => {
    // 防回归:溢价以前只在价格/汇率校验通过后才读取,免费节点填了溢价会被静默丢掉
    const summary = calculateCostSummary(
      [node({ uuid: "free", price: 0 })],
      [],
      RATES,
      { free: { amount: -30 } },
    );
    expect(noteCount(summary, "免费")).toBe(1);
    expect(summary.premiumTotalCny).toBe(-30);
    expect(summary.details[0].premiumCny).toBe(-30);
  });

  it("keeps premiums for rate-missing nodes (premium needs no conversion)", () => {
    const summary = calculateCostSummary(
      [node({ uuid: "nx", price: 10, currency: "GBP" })],
      [],
      RATES,
      { nx: { amount: 20 } },
    );
    expect(noteCount(summary, "汇率缺失")).toBe(1);
    expect(summary.premiumTotalCny).toBe(20);
    expect(summary.details[0].premiumCny).toBe(20);
  });

  it("keeps acquisition value for next-bill ignored nodes", () => {
    const summary = calculateCostSummary(
      [node({ uuid: "skip", name: "ignored-box", price: 10 })],
      ["ignored-box"],
      RATES,
      { skip: { amount: 99, acquiredAt: agoDays(60) } },
    );
    expect(noteCount(summary, "忽略下期账单")).toBe(1);
    expect(summary.monthlyCny).toBe(0);
    expect(summary.remainingCny).toBeGreaterThan(0);
    expect(summary.premiumTotalCny).toBe(99);
    expect(summary.details[0].premiumCny).toBe(99);
    expect(summary.details[0].premiumMonthlyCny).toBeGreaterThan(0);
  });
});

describe("calculateCostSummary — premium amortization", () => {
  it("amortizes premium over the acquired-to-expiry span so fresh entries are stable", () => {
    // 300 天前收购、60 天后到期 → 摊销跨度 360 天 = 12 个月;溢价 120 → 月摊 10
    const summary = calculateCostSummary(
      [node({ uuid: "p", price: 10, currency: "USD", billing_cycle: 30, expired_at: inDays(60) })],
      [],
      RATES,
      { p: { amount: 120, acquiredAt: agoDays(300) } },
    );
    const detail = summary.details[0];
    expect(detail.amortMonths).toBeCloseTo(12, 3);
    expect(detail.premiumMonthlyCny).toBeCloseTo(10, 3);
    expect(summary.premiumMonthlyTotalCny).toBeCloseTo(10, 3);
    expect(summary.effectiveMonthlyCny).toBeCloseTo(summary.monthlyCny + 10, 3);
    expect(detail.premiumRemainingCny).toBeCloseTo(20, 2);
    expect(summary.actualRemainingCny).toBeCloseTo(summary.remainingCny + 20, 2);
  });

  it("amortizes today's entry over the remaining span, not the elapsed holding", () => {
    // 防回归:分母曾是「已持有月数」,刚录入时被钳到 1 → 月摊 = 全额溢价
    const summary = calculateCostSummary(
      [node({ uuid: "p", price: 10, expired_at: inDays(300) })],
      [],
      RATES,
      { p: { amount: -100, acquiredAt: agoDays(0) } },
    );
    expect(summary.details[0].amortMonths).toBeCloseTo(10, 2);
    expect(summary.details[0].premiumMonthlyCny).toBeCloseTo(-10, 2);
  });

  it("clamps spans under one month and falls back to elapsed holding without an expiry", () => {
    const tiny = calculateCostSummary(
      [node({ uuid: "p", price: 10, expired_at: inDays(10) })],
      [],
      RATES,
      { p: { amount: 60, acquiredAt: agoDays(5) } },
    );
    expect(tiny.details[0].amortMonths).toBe(1);
    expect(tiny.details[0].premiumMonthlyCny).toBe(60);

    const noExpiry = calculateCostSummary(
      [node({ uuid: "p", price: 10, expired_at: "" })],
      [],
      RATES,
      { p: { amount: 30, acquiredAt: agoDays(90) } },
    );
    expect(noExpiry.details[0].amortMonths).toBeCloseTo(3, 3);
    expect(noExpiry.details[0].premiumMonthlyCny).toBeCloseTo(10, 3);
  });

  it("degrades honestly without acquiredAt: no amortization, effective monthly equals monthly", () => {
    const summary = calculateCostSummary(
      [node({ uuid: "p", price: 10, currency: "USD", billing_cycle: 30, expired_at: inDays(30) })],
      [],
      RATES,
      { p: { amount: 100 } },
    );
    expect(summary.details[0].amortMonths).toBeNull();
    expect(summary.details[0].premiumMonthlyCny).toBe(0);
    expect(summary.premiumMonthlyTotalCny).toBe(0);
    expect(summary.effectiveMonthlyCny).toBeCloseTo(summary.monthlyCny, 6);
    // 溢价总额不受影响:没有日期只是不摊销,不是不存在
    expect(summary.premiumTotalCny).toBe(100);
  });

  it("drops the remaining premium to zero when a fixed-term node expires", () => {
    const summary = calculateCostSummary(
      [node({ uuid: "p", price: 10, currency: "USD", billing_cycle: 30, expired_at: inDays(-1) })],
      [],
      RATES,
      { p: { amount: 500, paidCny: 1000, acquiredAt: agoDays(60) } },
    );
    expect(summary.remainingCny).toBe(0);
    expect(summary.premiumRemainingTotalCny).toBe(0);
    expect(summary.details[0].premiumRemainingCny).toBe(0);
    expect(summary.actualRemainingCny).toBe(0);
  });

});

describe("calculateCostSummary — annualized total & cycle validation", () => {
  it("annualizes totalCny so total === sum(monthly) * 12 across mixed cycles", () => {
    const summary = calculateCostSummary(
      [
        node({ uuid: "m", price: 10, currency: "USD", billing_cycle: "monthly" }),
        node({ uuid: "y", name: "yearly", price: 120, currency: "$", billing_cycle: "annual" }),
      ],
      [],
      RATES,
    );
    // 月付:70/月;年付:840/年 = 70/月 → 合计 140/月 → 1680/年
    expect(summary.monthlyCny).toBeCloseTo(140, 6);
    expect(summary.totalCny).toBeCloseTo(1680, 6);
    expect(summary.totalCny).toBeCloseTo(summary.monthlyCny * 12, 6);
  });

  it("converts via cross rates (EUR -> CNY)", () => {
    const summary = calculateCostSummary(
      [node({ uuid: "e", price: 10, currency: "€", billing_cycle: "monthly" })],
      [],
      RATES_X,
    );
    expect(summary.monthlyCny).toBeCloseTo((10 / 0.9) * 7, 6);
    expect(summary.totalCny).toBeCloseTo((10 / 0.9) * 7 * 12, 6);
  });

  it("skips nodes whose currency has no rate", () => {
    const summary = calculateCostSummary(
      [node({ uuid: "jpy", price: 1000, currency: "JPY", billing_cycle: "monthly" })],
      [],
      RATES,
    );
    expect(noteCount(summary, "汇率缺失")).toBe(1);
    expect(paidCount(summary)).toBe(0);
    expect(summary.totalCny).toBe(0);
  });

  it("falls back to a yearly cycle for invalid billing_cycle numerics", () => {
    const summary = calculateCostSummary(
      [
        node({ uuid: "zero", price: 120, currency: "USD", billing_cycle: 0 }),
        node({ uuid: "neg", name: "neg", price: 120, currency: "USD", billing_cycle: -7 }),
      ],
      [],
      RATES,
    );
    for (const detail of summary.details) {
      expect(detail.billingCycleDays).toBe(365);
    }
    expect(summary.monthlyCny).toBeCloseTo(140, 6);
  });

  it("keeps lifetime (-1) purchases out of recurring totals", () => {
    const summary = calculateCostSummary(
      [node({ uuid: "life", price: 99, currency: "USD", billing_cycle: "lifetime" })],
      [],
      RATES,
    );
    expect(summary.details[0]?.billingCycleDays).toBe(-1);
    expect(summary.monthlyCny).toBe(0);
    expect(summary.totalCny).toBe(0);
  });
});

describe("cost helpers", () => {
  it("normalizeCostIgnoredNodes splits, trims and dedupes", () => {
    expect(normalizeCostIgnoredNodes("a, b；b\nc")).toEqual(["a", "b", "c"]);
    expect(normalizeCostIgnoredNodes(["x", "", " y "])).toEqual(["x", "y"]);
  });

  it("normalizeCostPremiums upgrades legacy numbers and keeps only non-zero finite amounts", () => {
    expect(
      normalizeCostPremiums({
        paid: "12.5",
        discount: -3,
        zero: 0,
        zeroString: "0",
        bad: Number.POSITIVE_INFINITY,
        " spaced ": 8,
        "   ": 7,
        "": 9,
      }),
    ).toEqual({
      paid: { amount: 12.5 },
      discount: { amount: -3 },
      spaced: { amount: 8 },
    });
  });

  it("normalizeCostPremiums keeps paid-price records, including zero-premium ones", () => {
    expect(
      normalizeCostPremiums({
        fair: { amount: 0, paidCny: 100 },
        full: { amount: 30, paidCny: 130.5, acquiredAt: "2026-06-01" },
        badPaid: { amount: 10, paidCny: -5 },
      }),
    ).toEqual({
      fair: { amount: 0, paidCny: 100 },
      full: { amount: 30, paidCny: 130.5, acquiredAt: "2026-06-01" },
      badPaid: { amount: 10 },
    });
  });

  it("keeps the original premium basis when the paid price is edited later", () => {
    expect(calculateCostPremiumAmount(130, 100)).toBe(30);
    expect(
      calculateCostPremiumAmount(140, 20, { amount: 30, paidCny: 130 }),
    ).toBe(40);
  });

  it("backdates the one-time premium basis to the acquisition date", () => {
    const now = new Date(2026, 6, 15, 12).getTime();
    const acquiredAt = "2026-05-15";
    const acquired = calculateCostPremiumBasisAt(
      [
        node({
          uuid: "acquired",
          price: 30,
          currency: "CNY",
          billing_cycle: 30,
          expired_at: new Date(2026, 8, 15, 12).toISOString(),
        }),
      ],
      [],
      RATES,
      "acquired",
      acquiredAt,
      now,
    );
    const current = calculateCostPremiumBasisAt(
      [
        node({
          uuid: "acquired",
          price: 30,
          currency: "CNY",
          billing_cycle: 30,
          expired_at: new Date(2026, 8, 15, 12).toISOString(),
        }),
      ],
      [],
      RATES,
      "acquired",
      undefined,
      now,
    );

    expect(acquired).not.toBeNull();
    expect(current).not.toBeNull();
    expect(acquired!).toBeGreaterThan(current!);
    expect(calculateCostPremiumAmount(300, acquired!)).toBeLessThan(
      calculateCostPremiumAmount(300, current!),
    );
  });

  it("normalizeCostPremiums keeps valid acquiredAt and drops unparseable dates without dropping the entry", () => {
    expect(
      normalizeCostPremiums({
        dated: { amount: 50, acquiredAt: "2026-01-15" },
        badDate: { amount: 20, acquiredAt: "not a date" },
        spacedDate: { amount: 5, acquiredAt: "  2025-12-01  " },
        futureDate: { amount: 8, acquiredAt: "2999-01-01" },
        zeroWithDate: { amount: 0, acquiredAt: "2026-01-01" },
        noAmount: { acquiredAt: "2026-01-01" },
      }),
    ).toEqual({
      dated: { amount: 50, acquiredAt: "2026-01-15" },
      badDate: { amount: 20 },
      spacedDate: { amount: 5, acquiredAt: "2025-12-01" },
      futureDate: { amount: 8 },
    });
  });

  it("normalizeCostRateApiUrl falls back to the default", () => {
    expect(normalizeCostRateApiUrl("")).toBe(DEFAULT_COST_RATE_API_URL);
    expect(normalizeCostRateApiUrl("  https://x  ")).toBe("https://x");
  });

  it("normalizeCostRateApiUrl rejects non-http(s) values", () => {
    expect(normalizeCostRateApiUrl("ftp://example.com")).toBe(DEFAULT_COST_RATE_API_URL);
    expect(normalizeCostRateApiUrl("not a url")).toBe(DEFAULT_COST_RATE_API_URL);
    expect(normalizeCostRateApiUrl("javascript:alert(1)")).toBe(DEFAULT_COST_RATE_API_URL);
  });

  it("isCostRateApiUrlValid accepts only http(s)", () => {
    expect(isCostRateApiUrlValid("https://api.example.com/rates")).toBe(true);
    expect(isCostRateApiUrlValid("http://localhost:8080")).toBe(true);
    expect(isCostRateApiUrlValid("ftp://example.com")).toBe(false);
    expect(isCostRateApiUrlValid("garbage")).toBe(false);
  });

  it("formatCnyMoney guards NaN and formats two decimals", () => {
    expect(formatCnyMoney(1234.5)).toBe("¥ 1,234.50");
    expect(formatCnyMoney(Number.NaN)).toBe("¥ 0.00");
  });

  it("ignores malformed or future-dated exchange-rate caches", async () => {
    const entries = new Map<string, string>();
    const localStorageMock = {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => entries.set(key, value),
      removeItem: (key: string) => entries.delete(key),
    };
    const fetchMock = vi.fn().mockImplementation(async () =>
      new Response(JSON.stringify({ rates: { CNY: 7 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("localStorage", localStorageMock);
    vi.stubGlobal("fetch", fetchMock);

    const futureUrl = "https://cache.test/future";
    entries.set(
      `komaritheme:cost-rates:${futureUrl}`,
      JSON.stringify({ rates: { CNY: 999 }, time: Date.now() + 60_000 }),
    );
    const malformedUrl = "https://cache.test/malformed";
    entries.set(
      `komaritheme:cost-rates:${malformedUrl}`,
      JSON.stringify({ rates: "invalid", time: Date.now() }),
    );

    await expect(getExchangeRates(futureUrl)).resolves.toMatchObject({
      rates: { CNY: 7 },
    });
    await expect(getExchangeRates(malformedUrl)).resolves.toMatchObject({
      rates: { CNY: 7 },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("can bypass a fresh exchange-rate cache for manual refresh", async () => {
    const url = "https://cache.test/manual";
    const key = `komaritheme:cost-rates:${url}`;
    const entries = new Map([
      [key, JSON.stringify({ rates: { USD: 1, CNY: 6 }, time: Date.now() })],
    ]);
    const localStorageMock = {
      getItem: (name: string) => entries.get(name) ?? null,
      setItem: (name: string, value: string) => entries.set(name, value),
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ rates: { CNY: 7 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("localStorage", localStorageMock);
    vi.stubGlobal("fetch", fetchMock);

    await expect(getExchangeRates(url)).resolves.toMatchObject({ rates: { CNY: 6 } });
    await expect(getExchangeRates(url, { ignoreCache: true })).resolves.toMatchObject({
      rates: { CNY: 7 },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not replace a cancelled request with stale cached rates", async () => {
    const url = "https://cache.test/cancelled";
    const key = `komaritheme:cost-rates:${url}`;
    const entries = new Map([
      [
        key,
        JSON.stringify({
          rates: { USD: 1, CNY: 6 },
          time: Date.now() - 2 * 60 * 60 * 1000,
        }),
      ],
    ]);
    vi.stubGlobal("localStorage", {
      getItem: (name: string) => entries.get(name) ?? null,
      setItem: (name: string, value: string) => entries.set(name, value),
    });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("cancelled")));
    const controller = new AbortController();
    controller.abort();

    await expect(getExchangeRates(url, { signal: controller.signal })).rejects.toThrow(
      "cancelled",
    );
  });
});
