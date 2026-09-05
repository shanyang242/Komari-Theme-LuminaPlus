import { describe, expect, it } from "vitest";
import {
  DEFAULT_THEME_SETTINGS,
  normalizeThemeSettings,
  shouldShowAdminEntry,
} from "@/utils/themeSettings";
import { DEFAULT_BACKGROUND_VIDEO_URL } from "@/utils/background";

describe("normalizeThemeSettings", () => {
  it("defaults to image mode with the bundled desktop video ready to enable", () => {
    const settings = normalizeThemeSettings({});

    expect(settings.backgroundMediaType).toBe("image");
    expect(settings.backgroundVideo).toBe(DEFAULT_BACKGROUND_VIDEO_URL);
    expect(settings.backgroundVideoDark).toBe("");
    expect(settings.backgroundMediaType).toBe(DEFAULT_THEME_SETTINGS.backgroundMediaType);
    expect(settings.backgroundVideo).toBe(DEFAULT_THEME_SETTINGS.backgroundVideo);
    expect(normalizeThemeSettings({ backgroundVideo: "" }).backgroundVideo).toBe(
      DEFAULT_BACKGROUND_VIDEO_URL,
    );
  });

  it("keeps ambient effects opt-in and normalizes the selected preset", () => {
    const defaults = normalizeThemeSettings({});
    expect(defaults.enableAmbientEffect).toBe(false);
    expect(defaults.ambientEffect).toBe("sakura");

    expect(
      normalizeThemeSettings({
        enableAmbientEffect: true,
        ambientEffect: "leaves",
      }),
    ).toMatchObject({
      enableAmbientEffect: true,
      ambientEffect: "leaves",
    });
    expect(normalizeThemeSettings({ ambientEffect: "unknown" } as never).ambientEffect).toBe(
      "sakura",
    );
    expect(normalizeThemeSettings({ ambientEffect: "fireflies" } as never).ambientEffect).toBe(
      "sakura",
    );
    expect(normalizeThemeSettings({ enableAmbientEffect: "yes" } as never).enableAmbientEffect).toBe(
      false,
    );
  });

  it("normalizes the light and dark video fields independently", () => {
    const light = "https://cdn.example/day.mp4?Policy=a(b)&Signature=x%2By%3D";
    const dark = "/media/night%20sky.mp4?token=a%7Cb";
    const settings = normalizeThemeSettings({
      backgroundMediaType: "video",
      backgroundVideo: `  ${light}  `,
      backgroundVideoDark: `  ${dark}  `,
    });

    expect(settings.backgroundMediaType).toBe("video");
    expect(settings.backgroundVideo).toBe(light);
    expect(settings.backgroundVideoDark).toBe(dark);
  });

  it("does not migrate a pipe-delimited video value", () => {
    const settings = normalizeThemeSettings({
      backgroundVideo: "/light.mp4|/dark.mp4",
      backgroundVideoDark: "/night.mp4",
    });

    expect(settings.backgroundVideo).toBe(DEFAULT_BACKGROUND_VIDEO_URL);
    expect(settings.backgroundVideoDark).toBe("/night.mp4");
  });

  it("falls unknown media types back to image and rejects unsafe video URLs", () => {
    const settings = normalizeThemeSettings({
      backgroundMediaType: "animation",
      backgroundVideo: "javascript:alert(1)",
    } as never);

    expect(settings.backgroundMediaType).toBe("image");
    expect(settings.backgroundVideo).toBe(DEFAULT_BACKGROUND_VIDEO_URL);
    expect(settings.backgroundVideoDark).toBe("");
  });

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
  });

  it("normalizes complete per-node multi-ping overrides and drops malformed entries", () => {
    const resolved = normalizeThemeSettings({
      homepageMultiPingNodeTaskIds: {
        "node-a": [4, 2, 3],
        "node-b": [1, 1, 2],
      },
    });

    expect(resolved.homepageMultiPingNodeTaskIds).toEqual({
      "node-a": [4, 2, 3],
    });
    expect(normalizeThemeSettings({}).homepageMultiPingNodeTaskIds).toEqual({});
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

  it("keeps timed home header hiding opt-in and normalizes its duration", () => {
    const defaults = normalizeThemeSettings({});
    expect(defaults.enableHomeHeaderAutoHide).toBe(false);
    expect(defaults.homeHeaderVisibleSeconds).toBe(10);

    expect(
      normalizeThemeSettings({
        enableHomeHeaderAutoHide: true,
        homeHeaderVisibleSeconds: 12.6,
      }),
    ).toMatchObject({
      enableHomeHeaderAutoHide: true,
      homeHeaderVisibleSeconds: 13,
    });
    expect(normalizeThemeSettings({ homeHeaderVisibleSeconds: 0 }).homeHeaderVisibleSeconds).toBe(1);
    expect(
      normalizeThemeSettings({ homeHeaderVisibleSeconds: 9999 }).homeHeaderVisibleSeconds,
    ).toBe(3600);
  });

  it("hides the admin entry only from logged-out visitors when explicitly enabled", () => {
    const defaults = normalizeThemeSettings({});
    expect(defaults.hideAdminEntryWhenLoggedOut).toBe(false);
    expect(shouldShowAdminEntry(defaults, false)).toBe(true);

    const visitorHidden = normalizeThemeSettings({
      hideAdminEntryWhenLoggedOut: true,
    });
    expect(shouldShowAdminEntry(visitorHidden, false)).toBe(false);
    expect(shouldShowAdminEntry(visitorHidden, true)).toBe(true);

    // 旧字段继续作为全局总开关，避免改变存量手工配置的行为。
    const legacyDisabled = normalizeThemeSettings({ enableAdminButton: false });
    expect(shouldShowAdminEntry(legacyDisabled, false)).toBe(false);
    expect(shouldShowAdminEntry(legacyDisabled, true)).toBe(false);
  });

  it("parses hiddenNodes from a delimited string and dedupes", () => {
    expect(normalizeThemeSettings({}).hiddenNodes).toEqual([]);
    expect(
      normalizeThemeSettings({ hiddenNodes: "节点A, 节点A\nuuid-1；节点B" } as never).hiddenNodes,
    ).toEqual(["节点A", "uuid-1", "节点B"]);
  });
});
