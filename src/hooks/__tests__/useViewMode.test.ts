import { describe, expect, it } from "vitest";
import {
  getNextViewMode,
  MOBILE_VIEW_MODE_QUERY,
} from "@/hooks/useViewMode";

describe("view mode device contracts", () => {
  it("uses the inclusive 720px media boundary", () => {
    expect(MOBILE_VIEW_MODE_QUERY).toBe("(max-width: 720px)");
  });

  it("cycles between large and compact", () => {
    expect(getNextViewMode("large")).toBe("compact");
    expect(getNextViewMode("compact")).toBe("large");
  });
});
