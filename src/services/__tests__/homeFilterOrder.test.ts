import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError, getPublic, saveThemeSettings } from "@/services/api";
import { buildHomeFilterOrderSettings, persistHomeFilterOrder } from "@/services/homeFilterOrder";
import { PublicConfigSchema } from "@/types/komari";

vi.mock("@/services/api", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/services/api")>(),
  getPublic: vi.fn(),
  saveThemeSettings: vi.fn(),
}));

describe("saving home filter order", () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it("keeps unshown regions in their default slots on the first edit within a group", () => {
    const settings = buildHomeFilterOrderSettings(undefined, {
      field: "homeRegionOrder", visibleOrder: ["US", "JP"],
      availableOrder: ["HK", "SG", "JP", "US", "DE"],
    });
    expect(settings.homeRegionOrder).toEqual(["HK", "SG", "US", "JP", "DE"]);
  });

  it("retains temporarily absent groups and settings outside the edited field", () => {
    const previous = {
      homeGroupOrder: ["生产", "旧分组", "备份"], homeRegionOrder: ["JP", "US"],
      showRegionBar: false, customSetting: { nested: true },
    };
    expect(buildHomeFilterOrderSettings(previous, {
      field: "homeGroupOrder", visibleOrder: ["备份", "生产", "新分组"],
      availableOrder: ["生产", "备份", "新分组"],
    })).toEqual({ ...previous, homeGroupOrder: ["备份", "旧分组", "生产", "新分组"] });
    expect(previous.homeGroupOrder).toEqual(["生产", "旧分组", "备份"]);
  });

  it("merges a drop with the latest server settings before posting the whole configuration", async () => {
    const latest = {
      homeGroupOrder: ["生产", "备份"], homeRegionOrder: ["HK", "JP", "US"],
      surfaceOpacity: 85, showCostsToGuests: false, futureSetting: "preserved",
    };
    vi.mocked(getPublic).mockResolvedValue(PublicConfigSchema.parse({
      theme: "LuminaPlus", theme_settings: latest,
    }));
    vi.mocked(saveThemeSettings).mockResolvedValue(undefined);
    await expect(persistHomeFilterOrder("LuminaPlus", {
      field: "homeRegionOrder", visibleOrder: ["US", "HK", "JP"],
      availableOrder: ["HK", "JP", "US"],
    })).resolves.toEqual(["US", "HK", "JP"]);
    expect(saveThemeSettings).toHaveBeenCalledWith("LuminaPlus", {
      ...latest, homeRegionOrder: ["US", "HK", "JP"],
    });
  });

  it("does not write to an old theme after the active theme changes", async () => {
    vi.mocked(getPublic).mockResolvedValue(PublicConfigSchema.parse({ theme: "OtherTheme" }));
    await expect(persistHomeFilterOrder("LuminaPlus", {
      field: "homeGroupOrder", visibleOrder: ["备份", "生产"], availableOrder: ["生产", "备份"],
    })).rejects.toThrow("站点主题已切换");
    expect(saveThemeSettings).not.toHaveBeenCalled();
  });

  it("does not overwrite settings if the latest configuration cannot be read", async () => {
    vi.mocked(getPublic).mockRejectedValue(new Error("offline"));
    await expect(persistHomeFilterOrder("LuminaPlus", {
      field: "homeRegionOrder", visibleOrder: ["US", "JP"], availableOrder: ["JP", "US"],
    })).rejects.toThrow("offline");
    expect(saveThemeSettings).not.toHaveBeenCalled();
  });

  it("propagates a rejected admin write so the optimistic order can be rolled back", async () => {
    vi.mocked(getPublic).mockResolvedValue(PublicConfigSchema.parse({ theme: "LuminaPlus" }));
    const error = new ApiRequestError("Unauthorized", 401, "/api/admin/theme/settings");
    vi.mocked(saveThemeSettings).mockRejectedValue(error);
    await expect(persistHomeFilterOrder("LuminaPlus", {
      field: "homeGroupOrder", visibleOrder: ["备份", "生产"], availableOrder: ["生产", "备份"],
    })).rejects.toBe(error);
  });
});
