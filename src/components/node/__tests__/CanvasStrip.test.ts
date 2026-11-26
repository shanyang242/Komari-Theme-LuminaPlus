import { describe, expect, it } from "vitest";
import { safeCanvasColor } from "@/components/node/CanvasStrip";

describe("safeCanvasColor", () => {
  it("preserves alpha channel for hsla() and CSS Color 4 slash hsl() syntax", () => {
    expect(safeCanvasColor("hsla(200, 80%, 50%, 0.4)")).toBe("rgba(25, 161, 230, 0.4)");
    expect(safeCanvasColor("hsl(200 80% 50% / 50%)")).toBe("rgba(25, 161, 230, 0.5)");
    expect(safeCanvasColor("hsla(0, 100%, 50%, 1.5)")).toBe("rgba(255, 0, 0, 1)");
    expect(safeCanvasColor("hsl(200, 80%, 50%)")).toBe("rgb(25, 161, 230)");
  });
});
