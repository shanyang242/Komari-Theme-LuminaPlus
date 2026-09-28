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
        ambientEffect: "rain",
      }),
    ).toMatchObject({
      enableAmbientEffect: true,
      ambientEffect: "rain",
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

  it("normalizes per-node single-ping overrides", () => {
    const resolved = normalizeThemeSettings({
      homepagePingNodeTaskIds: {
        "node-a": 4,
        "node-b": null,
        "node-c": -1,
      },
    });

    expect(resolved.homepagePingNodeTaskIds).toEqual({
      "node-a": 4,
      "node-b": null,
    });
    expect(normalizeThemeSettings({}).homepagePingNodeTaskIds).toEqual({});
  });

  it("migrates legacy single bindings unless the new setting is explicitly present", () => {
    expect(normalizeThemeSettings({
      homepagePingBindings: { "7": ["node-a"] },
    } as never).homepagePingNodeTaskIds).toEqual({ "node-a": 7 });
    expect(normalizeThemeSettings({
      homepagePingNodeTaskIds: {},
      homepagePingBindings: { "7": ["node-a"] },
    } as never).homepagePingNodeTaskIds).toEqual({});
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
    expect(canViewCosts({ ...defaults, isReady: true, isError: false }, false)).toBe(true);

    const privateCosts = normalizeThemeSettings({ showCostsToGuests: false });
    expect(canViewCosts({ ...privateCosts, isReady: true, isError: false }, false)).toBe(false);
    expect(canViewCosts({ ...privateCosts, isReady: true, isError: false }, true)).toBe(true);
  });

  it("keeps costs hidden when public settings are unavailable", () => {
    const defaults = normalizeThemeSettings({});
    expect(canViewCosts({ ...defaults, isReady: false, isError: false }, false)).toBe(false);
    expect(canViewCosts({ ...defaults, isReady: true, isError: true }, false)).toBe(false);
    expect(canViewCosts({ ...defaults, isReady: true, isError: true }, true)).toBe(false);
  });

  it("parses hiddenNodes from a delimited string and dedupes", () => {
    expect(normalizeThemeSettings({}).hiddenNodes).toEqual([]);
    expect(
      normalizeThemeSettings({ hiddenNodes: "节点A, 节点A\nuuid-1；节点B" } as never).hiddenNodes,
    ).toEqual(["节点A", "uuid-1", "节点B"]);
  });
});
