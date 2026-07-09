import { describe, expect, it } from "vitest";
import { normalizeThemeSettings } from "@/utils/themeSettings";

describe("normalizeThemeSettings", () => {
  it("defaults overview ratings on unless explicitly disabled", () => {
    expect(normalizeThemeSettings({}).showOverviewRatings).toBe(true);
    expect(normalizeThemeSettings({ showOverviewRatings: false }).showOverviewRatings).toBe(false);
  });

  it("defaults home sort to weight ascending and falls back to a field's natural direction", () => {
    const base = normalizeThemeSettings({});
    expect(base.enableHomeSort).toBe(true);
    expect(base.homeSortField).toBe("default");
    expect(base.homeSortDirection).toBe("asc");

    // 指定字段但缺省方向 → 回落该字段自然方向(网速为降序)。
    expect(normalizeThemeSettings({ homeSortField: "speed" } as never).homeSortDirection).toBe("desc");
    // 非法字段回落 default。
    expect(normalizeThemeSettings({ homeSortField: "nope" } as never).homeSortField).toBe("default");
  });

  it("keeps fake ping off unless explicitly enabled", () => {
    expect(normalizeThemeSettings({}).fakePingForUnbound).toBe(false);
    expect(normalizeThemeSettings({ fakePingForUnbound: true }).fakePingForUnbound).toBe(true);
    // 非布尔真值不算显式开启。
    expect(
      normalizeThemeSettings({ fakePingForUnbound: "yes" } as never).fakePingForUnbound,
    ).toBe(false);
  });

  it("parses hiddenNodes from a delimited string and dedupes", () => {
    expect(normalizeThemeSettings({}).hiddenNodes).toEqual([]);
    expect(
      normalizeThemeSettings({ hiddenNodes: "节点A, 节点A\nuuid-1；节点B" } as never).hiddenNodes,
    ).toEqual(["节点A", "uuid-1", "节点B"]);
  });

  it("defaults site header on unless explicitly disabled", () => {
    expect(normalizeThemeSettings({}).showSiteHeader).toBe(true);
    expect(normalizeThemeSettings({ showSiteHeader: false }).showSiteHeader).toBe(false);
    // 非布尔假值不算关闭(只有严格 false 才关)。
    expect(normalizeThemeSettings({ showSiteHeader: "no" } as never).showSiteHeader).toBe(true);
  });

  it("normalizes the site header logo url: defaults empty, trims, ignores non-strings", () => {
    expect(normalizeThemeSettings({}).siteHeaderLogo).toBe("");
    expect(
      normalizeThemeSettings({ siteHeaderLogo: "  https://a.com/logo.png  " } as never)
        .siteHeaderLogo,
    ).toBe("https://a.com/logo.png");
    expect(normalizeThemeSettings({ siteHeaderLogo: 123 } as never).siteHeaderLogo).toBe("");
  });
});
