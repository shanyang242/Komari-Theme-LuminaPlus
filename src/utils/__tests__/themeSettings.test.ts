import { describe, expect, it } from "vitest";
import { normalizeThemeSettings } from "@/utils/themeSettings";

describe("normalizeThemeSettings", () => {
  it("keeps mini and falls unknown saved view modes back to compact", () => {
    const settings = normalizeThemeSettings({
      desktopNodeViewMode: "retired-view",
      mobileNodeViewMode: "retired-view",
    } as never);

    expect(settings.desktopNodeViewMode).toBe("compact");
    expect(settings.mobileNodeViewMode).toBe("compact");
    expect(normalizeThemeSettings({ desktopNodeViewMode: "mini" }).desktopNodeViewMode).toBe(
      "mini",
    );
    expect(normalizeThemeSettings({ mobileNodeViewMode: "mini" }).mobileNodeViewMode).toBe("mini");
    expect(normalizeThemeSettings({ mobileNodeViewMode: "list" }).mobileNodeViewMode).toBe(
      "compact",
    );
  });

  it("defaults overview ratings on unless explicitly disabled", () => {
    expect(normalizeThemeSettings({}).showOverviewRatings).toBe(true);
    expect(normalizeThemeSettings({ showOverviewRatings: false }).showOverviewRatings).toBe(false);
  });

  it("normalizes homepage multi-ping tasks while preserving an enabled draft for repair", () => {
    expect(normalizeThemeSettings({}).enableHomepageMultiPing).toBe(false);
    expect(
      normalizeThemeSettings({
        enableHomepageMultiPing: true,
        homepageMultiPingTaskIds: [3, 1],
      }).enableHomepageMultiPing,
    ).toBe(true);

    const resolved = normalizeThemeSettings({
      enableHomepageMultiPing: true,
      homepageMultiPingTaskIds: [3, 1, 3, 2, 4],
    });
    expect(resolved.enableHomepageMultiPing).toBe(true);
    expect(resolved.homepageMultiPingTaskIds).toEqual([3, 1, 2]);
    // 旧字段回落为「第一套 + 全部节点」,保证升级后行为不变。
    expect(resolved.homepageMultiPingGroups).toEqual([
      { taskIds: [3, 1, 2], clientUuids: [] },
    ]);
  });

  it("normalizes homepage multi-ping groups with per-group node selections", () => {
    const resolved = normalizeThemeSettings({
      enableHomepageMultiPing: true,
      homepageMultiPingTaskIds: [7, 8, 9],
      homepageMultiPingGroups: [
        { taskIds: [1, 2, 3], clientUuids: ["node-a", "node-a", "node-b"] },
        { taskIds: [4, 5, 6], clientUuids: ["node-c"] },
        { taskIds: [] },
      ],
    } as never);
    expect(resolved.homepageMultiPingGroups).toEqual([
      { taskIds: [1, 2, 3], clientUuids: ["node-a", "node-b"] },
      { taskIds: [4, 5, 6], clientUuids: ["node-c"] },
    ]);
  });

  it("defaults homepage multi-ping groups to empty", () => {
    expect(normalizeThemeSettings({}).homepageMultiPingGroups).toEqual([]);
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
});
