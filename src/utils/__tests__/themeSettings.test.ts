import { describe, expect, it } from "vitest";
import {
  canViewCosts,
  normalizeThemeSettings,
  shouldShowAdminEntry,
} from "@/utils/themeSettings";

describe("normalizeThemeSettings", () => {
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

  it("can hide costs from guests without affecting logged-in administrators", () => {
    const defaults = normalizeThemeSettings({});
    expect(defaults.showCostsToGuests).toBe(true);
    expect(canViewCosts(defaults, false)).toBe(true);

    const privateCosts = normalizeThemeSettings({ showCostsToGuests: false });
    expect(canViewCosts(privateCosts, false)).toBe(false);
    expect(canViewCosts(privateCosts, true)).toBe(true);
  });

  it("parses hiddenNodes from a delimited string and dedupes", () => {
    expect(normalizeThemeSettings({}).hiddenNodes).toEqual([]);
    expect(
      normalizeThemeSettings({ hiddenNodes: "节点A, 节点A\nuuid-1；节点B" } as never).hiddenNodes,
    ).toEqual(["节点A", "uuid-1", "节点B"]);
  });
});
