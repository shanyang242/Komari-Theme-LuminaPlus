import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyBackgroundCache,
  buildBackgroundCache,
  computeBackgroundScrim,
  DEFAULT_BACKGROUND_ALIGNMENT,
  DEFAULT_SURFACE_OPACITY,
  isBackgroundUrlValid,
  normalizeBackgroundAlignment,
  normalizeBackgroundUrl,
  normalizeBackgroundVideoUrl,
  normalizeSurfaceOpacity,
  parseBackgroundAlignment,
  releaseBackgroundVideo,
  resolveBackgroundVideoSource,
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

describe("background image draft validation", () => {
  it.each(["", " /light.webp | /dark.webp ", "|/dark.webp", "https://example.com/a%20b.webp"])(
    "accepts a supported background draft: %s",
    (value) => expect(isBackgroundUrlValid(value)).toBe(true),
  );

  it.each(["//cdn.example.com/bg.webp", "data:image/png;base64,AAAA", "/light.webp|javascript:alert(1)", "/a b.webp", "/a|/b|/c"])(
    "flags any input that would be silently dropped or changed: %s",
    (value) => expect(isBackgroundUrlValid(value)).toBe(false),
  );
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

  it("rejects dangerous URI schemes while keeping http(s) and relative paths", () => {
    expect(normalizeBackgroundUrl("javascript:alert(1)")).toBe("");
    expect(normalizeBackgroundUrl("java\nscript:alert(1)")).toBe("");
    expect(normalizeBackgroundUrl("data:image/svg+xml,<svg/>")).toBe("");
    expect(normalizeBackgroundUrl("vbscript:msgbox(1)")).toBe("");
    expect(normalizeBackgroundUrl("//evil.example/bg.png")).toBe("");
    expect(normalizeBackgroundUrl("javascript:alert(1)|https://ok.example/dark.webp")).toBe(
      "|https://ok.example/dark.webp",
    );
  });
});

describe("normalizeBackgroundVideoUrl", () => {
  it("keeps signed query strings, fragments, and encoded delimiters unchanged", () => {
    const signed =
      "https://cdn.example/video.mp4?Policy=a%28b%29&Signature=x%2By%3D#scene";
    const encodedDelimiter = "/media/night%20sky.mp4?token=a%7Cb";

    expect(normalizeBackgroundVideoUrl(`  ${signed}  `)).toBe(signed);
    expect(normalizeBackgroundVideoUrl(encodedDelimiter)).toBe(encodedDelimiter);
  });

  it("rejects literal pair delimiters because each appearance has its own field", () => {
    expect(normalizeBackgroundVideoUrl("/light.mp4|/dark.mp4")).toBe("");
    expect(normalizeBackgroundVideoUrl("|/dark.mp4")).toBe("");
  });

  it("allows only HTTP(S) URLs and absolute site paths without credentials", () => {
    expect(normalizeBackgroundVideoUrl("http://cdn.example/a.mp4")).toBe(
      "http://cdn.example/a.mp4",
    );
    expect(normalizeBackgroundVideoUrl("/media/a.mp4")).toBe("/media/a.mp4");

    for (const unsafe of [
      "javascript:alert(1)",
      "data:video/mp4;base64,AAAA",
      "blob:https://example.test/id",
      "file:///tmp/a.mp4",
      "//cdn.example/a.mp4",
      "media/a.mp4",
      "https://user:pass@cdn.example/a.mp4",
      "https://cdn.example/a\n.mp4",
    ]) {
      expect(normalizeBackgroundVideoUrl(unsafe)).toBe("");
    }
  });

  it("rejects backslash host confusion, incomplete schemes, and ordinary spaces", () => {
    for (const unsafe of [
      String.raw`/\evil.example/x.mp4`,
      String.raw`https:\evil.example/x.mp4`,
      "https:example.com/v.mp4",
      "https://cdn.example/a b.mp4",
      "/media/a b.mp4",
    ]) {
      expect(normalizeBackgroundVideoUrl(unsafe)).toBe("");
    }
  });

  it("accepts case-insensitive HTTP(S) schemes without rewriting signed URLs", () => {
    const signed =
      "HTTPS://CDN.Example/Video.mp4?Policy=a%28b%29&Signature=AbC%2B%3D#Frame";

    expect(normalizeBackgroundVideoUrl(signed)).toBe(signed);
  });

  it("enforces the URL length limit per appearance without truncating video URLs", () => {
    const maximum = `/${"a".repeat(2047)}`;
    const tooLong = `/${"a".repeat(2048)}`;

    expect(normalizeBackgroundVideoUrl(maximum)).toBe(maximum);
    expect(normalizeBackgroundVideoUrl(tooLong)).toBe("");
    expect(normalizeBackgroundVideoUrl(undefined)).toBe("");
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

describe("resolveBackgroundVideoSource", () => {
  const desktopVideo = {
    enabled: true,
    mediaType: "video" as const,
    videoUrl: "/light.mp4",
    videoUrlDark: "/dark.mp4",
    appearance: "light" as const,
    isMobile: false,
    reducedMotion: false,
    saveData: false,
  };

  it("selects the current appearance and falls back to light for dark mode", () => {
    expect(resolveBackgroundVideoSource(desktopVideo)).toBe("/light.mp4");
    expect(
      resolveBackgroundVideoSource({ ...desktopVideo, appearance: "dark" }),
    ).toBe("/dark.mp4");
    expect(
      resolveBackgroundVideoSource({
        ...desktopVideo,
        videoUrlDark: "",
        appearance: "dark",
      }),
    ).toBe("/light.mp4");
  });

  it("returns no source before mobile or constrained clients can start a request", () => {
    expect(resolveBackgroundVideoSource({ ...desktopVideo, isMobile: true })).toBe("");
    expect(resolveBackgroundVideoSource({ ...desktopVideo, reducedMotion: true })).toBe("");
    expect(resolveBackgroundVideoSource({ ...desktopVideo, saveData: true })).toBe("");
    expect(resolveBackgroundVideoSource({ ...desktopVideo, enabled: false })).toBe("");
    expect(
      resolveBackgroundVideoSource({ ...desktopVideo, mediaType: "image" }),
    ).toBe("");
  });
});

describe("releaseBackgroundVideo", () => {
  it("pauses, clears src, then reloads in resource-release order", () => {
    const calls: string[] = [];
    const video = {
      pause: vi.fn(() => calls.push("pause")),
      removeAttribute: vi.fn((name: string) => calls.push(`remove:${name}`)),
      load: vi.fn(() => calls.push("load")),
    };

    releaseBackgroundVideo(video);

    expect(calls).toEqual(["pause", "remove:src", "load"]);
    expect(video.removeAttribute).toHaveBeenCalledWith("src");
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
    backgroundMediaType: "image" as const,
    backgroundImage: "",
    backgroundImageMobile: "",
    backgroundVideo: "",
    backgroundVideoDark: "",
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

  it("keeps video URLs out of the first-frame image cache", () => {
    const videoUrl = "https://cdn.example/background.mp4?signature=secret";
    const cache = buildBackgroundCache({
      ...base,
      backgroundMediaType: "video",
      backgroundImage: "/poster.webp",
      backgroundVideo: videoUrl,
    });

    expect(cache).not.toBeNull();
    expect(cache?.v).toBe(2);
    expect(cache?.desktopVideo).toBe(true);
    expect(cache?.lightDesktop).toBe('url("/poster.webp")');
    expect(cache).not.toHaveProperty("backgroundVideo");
    expect(JSON.stringify(cache)).not.toContain(videoUrl);
  });

  it("can cache video-only surface settings without caching a video source", () => {
    const cache = buildBackgroundCache({
      ...base,
      backgroundMediaType: "video",
      backgroundVideo: "/background.mp4",
      surfaceOpacity: 70,
    });

    expect(cache).not.toBeNull();
    expect(cache?.desktopVideo).toBe(true);
    expect(cache?.lightDesktop).toBe("none");
    expect(cache?.darkDesktop).toBe("none");
    expect(cache?.lightMobile).toBe("none");
    expect(cache?.darkMobile).toBe("none");
    expect(JSON.stringify(cache)).not.toContain("/background.mp4");
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
    backgroundMediaType: "image" as const,
    backgroundImage: "",
    backgroundImageMobile: "",
    backgroundVideo: "",
    backgroundVideoDark: "",
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

  it("removes stale surface variables when the selected image is none", () => {
    const cache = buildBackgroundCache({
      ...base,
      backgroundMediaType: "video",
      backgroundVideo: "/background.mp4",
    });
    expect(cache).not.toBeNull();
    const { properties } = installDocumentStyle({
      "--surface-alpha": "25",
      "--bg-scrim": "stale-scrim",
    });

    applyBackgroundCache(cache, "light", { isMobile: false, videoState: "loading" });

    expect(properties.get("--bg-image-desktop")).toBe("none");
    expect(properties.has("--surface-alpha")).toBe(false);
    expect(properties.has("--bg-scrim")).toBe(false);
  });

  it("writes surface variables for an active video without a poster", () => {
    const cache = buildBackgroundCache({
      ...base,
      backgroundMediaType: "video",
      backgroundVideo: "/background.mp4",
    });
    expect(cache).not.toBeNull();
    const { properties } = installDocumentStyle();

    applyBackgroundCache(cache, "dark", { isMobile: false, videoState: "playing" });

    expect(properties.get("--surface-alpha")).toBe("50");
    expect(properties.get("--bg-scrim")).toContain("color-mix");
  });

  it("hides the desktop fallback while loading and restores it after failure", () => {
    const cache = buildBackgroundCache({
      ...base,
      backgroundMediaType: "video",
      backgroundImage: "/poster.webp",
      backgroundImageMobile: "/mobile.webp",
      backgroundVideo: "/background.mp4",
    });
    expect(cache).not.toBeNull();
    const { properties } = installDocumentStyle();

    applyBackgroundCache(cache, "light", { isMobile: false, videoState: "loading" });
    expect(properties.get("--bg-image-desktop")).toBe("none");
    expect(properties.get("--bg-image-mobile")).toBe('url("/mobile.webp")');
    expect(properties.has("--surface-alpha")).toBe(false);

    applyBackgroundCache(cache, "light", { isMobile: false, videoState: "failed" });
    expect(properties.get("--bg-image-desktop")).toBe('url("/poster.webp")');
    expect(properties.get("--surface-alpha")).toBe("50");
    expect(properties.get("--bg-scrim")).toContain("color-mix");
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
