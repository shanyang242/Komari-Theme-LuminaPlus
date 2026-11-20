import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("supportsFineHover", () => {
  it("allows mouse and pen input even when the device reports no fine hover", async () => {
    const matchMedia = vi.fn(() => ({ matches: false }));
    vi.stubGlobal("window", { matchMedia });
    const { supportsFineHover } = await import("../mediaQuery");

    expect(supportsFineHover("mouse")).toBe(true);
    expect(supportsFineHover("pen")).toBe(true);
    expect(supportsFineHover("touch")).toBe(false);
    expect(matchMedia).not.toHaveBeenCalled();
    expect(supportsFineHover()).toBe(false);
  });

  it("rejects touch input even on a device with a mouse", async () => {
    vi.stubGlobal("window", { matchMedia: () => ({ matches: true }) });
    const { supportsFineHover } = await import("../mediaQuery");

    expect(supportsFineHover()).toBe(true);
    expect(supportsFineHover("touch")).toBe(false);
  });

  it("uses the current media query result for missing or unknown pointer types", async () => {
    const query = { matches: false };
    const matchMedia = vi.fn(() => query);
    vi.stubGlobal("window", { matchMedia });
    const { supportsFineHover } = await import("../mediaQuery");

    expect(supportsFineHover("")).toBe(false);
    query.matches = true;
    expect(supportsFineHover()).toBe(true);
    expect(supportsFineHover("unknown")).toBe(true);
    expect(matchMedia).toHaveBeenCalledTimes(1);
  });

  it("handles unavailable media queries", async () => {
    vi.stubGlobal("window", undefined);
    const { supportsFineHover } = await import("../mediaQuery");
    expect(supportsFineHover()).toBe(false);

    vi.stubGlobal("window", {});
    expect(supportsFineHover()).toBe(false);
    expect(supportsFineHover("mouse")).toBe(true);
  });
});
