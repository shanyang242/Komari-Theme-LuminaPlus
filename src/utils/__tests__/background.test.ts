import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyBackgroundCache,
  buildBackgroundCache,
  computeBackgroundScrim,
  DEFAULT_BACKGROUND_ALIGNMENT,
  DEFAULT_SURFACE_OPACITY,
  normalizeBackgroundAlignment,
  normalizeBackgroundUrl,
  normalizeSurfaceOpacity,
  parseBackgroundAlignment,
  resolveBackgroundUrl,
  SURFACE_SCRIM_THRESHOLD,
} from "@/utils/background";

const BACKGROUND_STYLE_VARS = [
  "--bg-image-desktop",
  "--bg-image-mobile",
  "--bg-size",
  "--bg-position",
  "--surface-alpha",
  "--bg-scrim",
] as const;

function installDocumentStyle(initial: Record<string, string> = {}) {
  const properties = new Map(Object.entries(initial));
  const style = {
    setProperty: vi.fn((name: string, value: string) => {
      properties.set(name, value);
    }),
    removeProperty: vi.fn((name: string) => {
      const previous = properties.get(name) ?? "";
      properties.delete(name);
      return previous;
    }),
  };
  vi.stubGlobal("document", { documentElement: { style } });
  return { properties, style };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("normalizeBackgroundUrl", () => {
  it("trims and keeps a single url", () => {
    expect(normalizeBackgroundUrl("  https://x/a.webp  ")).toBe("https://x/a.webp");
  });

  it("returns empty for non-strings", () => {
    expect(normalizeBackgroundUrl(undefined)).toBe("");
    expect(normalizeBackgroundUrl(42)).toBe("");
  });

  it("keeps a light|dark pair when they differ", () => {
    expect(normalizeBackgroundUrl("/light.webp | /dark.webp")).toBe("/light.webp|/dark.webp");
  });

  it("collapses identical light/dark to a single url", () => {
    expect(normalizeBackgroundUrl("/same.webp|/same.webp")).toBe("/same.webp");
  });

  it("preserves a dark-only pair", () => {
    expect(normalizeBackgroundUrl("|/dark.webp")).toBe("|/dark.webp");
  });

  it("ignores a third segment", () => {
    expect(normalizeBackgroundUrl("/a|/b|/c")).toBe("/a|/b");
  });

  it("strips characters that could break out of url()", () => {
    expect(normalizeBackgroundUrl('/a.webp")body{x')).toBe("/a.webpbody{x");
    expect(normalizeBackgroundUrl("/a b.webp")).toBe("/ab.webp");
    expect(normalizeBackgroundUrl("/a(b).webp")).toBe("/ab.webp");
  });
});

describe("resolveBackgroundUrl", () => {
  it("returns the single url for both appearances", () => {
    expect(resolveBackgroundUrl("/a.webp", "light")).toBe("/a.webp");
    expect(resolveBackgroundUrl("/a.webp", "dark")).toBe("/a.webp");
  });

  it("selects light vs dark from a pair", () => {
    expect(resolveBackgroundUrl("/light.webp|/dark.webp", "light")).toBe("/light.webp");
    expect(resolveBackgroundUrl("/light.webp|/dark.webp", "dark")).toBe("/dark.webp");
  });

  it("returns empty for a missing side of a pair", () => {
    expect(resolveBackgroundUrl("|/dark.webp", "light")).toBe("");
    expect(resolveBackgroundUrl("|/dark.webp", "dark")).toBe("/dark.webp");
  });

  it("returns empty for empty input", () => {
    expect(resolveBackgroundUrl("", "dark")).toBe("");
  });
});

describe("parseBackgroundAlignment / normalizeBackgroundAlignment", () => {
  it("defaults invalid input to cover,center", () => {
    expect(parseBackgroundAlignment("garbage")).toEqual({ size: "cover", position: "center" });
    expect(parseBackgroundAlignment(undefined)).toEqual({ size: "cover", position: "center" });
    expect(normalizeBackgroundAlignment("nonsense")).toBe(DEFAULT_BACKGROUND_ALIGNMENT);
  });

  it("accepts valid size/position pairs", () => {
    expect(parseBackgroundAlignment("contain,top")).toEqual({ size: "contain", position: "top" });
    expect(normalizeBackgroundAlignment(" AUTO , BOTTOM ")).toBe("auto,bottom");
  });

  it("falls back per-field", () => {
    expect(parseBackgroundAlignment("contain,wat")).toEqual({ size: "contain", position: "center" });
    expect(parseBackgroundAlignment("wat,top")).toEqual({ size: "cover", position: "top" });
  });
});

describe("normalizeSurfaceOpacity", () => {
  it("defaults non-numeric to 100", () => {
    expect(normalizeSurfaceOpacity(undefined)).toBe(DEFAULT_SURFACE_OPACITY);
    expect(normalizeSurfaceOpacity("abc")).toBe(100);
  });

  it("clamps to 0–100 and rounds", () => {
    expect(normalizeSurfaceOpacity(150)).toBe(100);
    expect(normalizeSurfaceOpacity(-20)).toBe(0);
    expect(normalizeSurfaceOpacity(72.6)).toBe(73);
    expect(normalizeSurfaceOpacity("60")).toBe(60);
  });
});

describe("computeBackgroundScrim", () => {
  it("is zero at/above the threshold (zero cost default)", () => {
    expect(computeBackgroundScrim(100)).toBe(0);
    expect(computeBackgroundScrim(SURFACE_SCRIM_THRESHOLD)).toBe(0);
  });

  it("ramps the scrim gently as opacity drops (no blur involved)", () => {
    // 半透明观感只由"纯半透明表面 + 可读性遮罩"构成,刻意没有 backdrop-filter 磨砂
    // (GPU 渲染差异会让双端观感不一致,防回归)。
    const mid = computeBackgroundScrim(50);
    expect(mid).toBeGreaterThan(0);

    const low = computeBackgroundScrim(0);
    expect(low).toBeGreaterThanOrEqual(mid);
    expect(low).toBeLessThanOrEqual(16);
  });
});

describe("buildBackgroundCache", () => {
  const base = {
    enableBackgroundImage: true,
    backgroundImage: "",
    backgroundImageMobile: "",
    backgroundAlignment: DEFAULT_BACKGROUND_ALIGNMENT,
    surfaceOpacity: DEFAULT_SURFACE_OPACITY,
  };

  it("returns null when no image is configured", () => {
    expect(buildBackgroundCache(base)).toBeNull();
  });

  it("returns null when the toggle is off, even with urls configured", () => {
    // 开关关闭 = 与未配置等价:不写变量、不发图片请求;URL 仍保留在设置里。
    expect(
      buildBackgroundCache({
        ...base,
        enableBackgroundImage: false,
        backgroundImage: "/a.webp",
        surfaceOpacity: 50,
      }),
    ).toBeNull();
  });

  it("resolves both appearances and wraps urls in url()", () => {
    const cache = buildBackgroundCache({
      ...base,
      backgroundImage: "/light.webp|/dark.webp",
    });
    expect(cache).not.toBeNull();
    expect(cache?.lightDesktop).toBe('url("/light.webp")');
    expect(cache?.darkDesktop).toBe('url("/dark.webp")');
    // 没设置移动端图时回退到桌面端
    expect(cache?.darkMobile).toBe('url("/dark.webp")');
  });

  it("omits the scrim at full opacity but includes it when transparent", () => {
    const solid = buildBackgroundCache({ ...base, backgroundImage: "/a.webp" });
    expect(solid?.scrim).toBe("");
    expect(solid?.alpha).toBe("100");

    const translucent = buildBackgroundCache({
      ...base,
      backgroundImage: "/a.webp",
      surfaceOpacity: 50,
    });
    expect(translucent?.alpha).toBe("50");
    expect(translucent?.scrim).toContain("color-mix");
  });
});

describe("applyBackgroundCache", () => {
  const base = {
    enableBackgroundImage: true,
    backgroundImage: "",
    backgroundImageMobile: "",
    backgroundAlignment: "contain,bottom",
    surfaceOpacity: 50,
  };

  it("clears all managed variables and leaves unrelated styles alone for a null cache", () => {
    const initial = Object.fromEntries(
      BACKGROUND_STYLE_VARS.map((name) => [name, "stale"]),
    );
    const { properties, style } = installDocumentStyle({
      ...initial,
      "--unrelated": "keep",
    });

    applyBackgroundCache(null, "light", { isMobile: false });

    expect(style.removeProperty.mock.calls.map(([name]) => name)).toEqual(
      BACKGROUND_STYLE_VARS,
    );
    for (const name of BACKGROUND_STYLE_VARS) expect(properties.has(name)).toBe(false);
    expect(properties.get("--unrelated")).toBe("keep");
  });

  it("applies light/dark sources and uses the selected desktop/mobile image for activity", () => {
    const cache = buildBackgroundCache({
      ...base,
      backgroundImage: "|/desktop-dark.webp",
      backgroundImageMobile: "/mobile-light.webp|/mobile-dark.webp",
    });
    expect(cache).not.toBeNull();
    const { properties } = installDocumentStyle();

    applyBackgroundCache(cache, "light", { isMobile: false });
    expect(properties.get("--bg-image-desktop")).toBe("none");
    expect(properties.get("--bg-image-mobile")).toBe('url("/mobile-light.webp")');
    expect(properties.has("--surface-alpha")).toBe(false);

    applyBackgroundCache(cache, "light", { isMobile: true });
    expect(properties.get("--surface-alpha")).toBe("50");
    expect(properties.get("--bg-scrim")).toContain("color-mix");

    applyBackgroundCache(cache, "dark", { isMobile: false });
    expect(properties.get("--bg-image-desktop")).toBe('url("/desktop-dark.webp")');
    expect(properties.get("--bg-image-mobile")).toBe('url("/mobile-dark.webp")');
    expect(properties.get("--bg-size")).toBe("contain");
    expect(properties.get("--bg-position")).toBe("bottom");
  });

  it("clears an old scrim when the active cache has no scrim", () => {
    const cache = buildBackgroundCache({
      ...base,
      backgroundImage: "/poster.webp",
      surfaceOpacity: 100,
    });
    expect(cache).not.toBeNull();
    const { properties, style } = installDocumentStyle({
      "--bg-scrim": "stale-scrim",
    });

    applyBackgroundCache(cache, "light", { isMobile: false });

    expect(properties.get("--surface-alpha")).toBe("100");
    expect(properties.has("--bg-scrim")).toBe(false);
    expect(style.removeProperty).toHaveBeenCalledWith("--bg-scrim");
  });
});
