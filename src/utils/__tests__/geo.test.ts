import { describe, expect, it } from "vitest";
import { getCountryCodeFromRegion, getDisplayRegionCode } from "@/utils/geo";

describe("getCountryCodeFromRegion", () => {
  it("decodes flag emoji to an ISO code", () => {
    expect(getCountryCodeFromRegion("🇩🇪")).toBe("DE");
    expect(getCountryCodeFromRegion("🇺🇸 Los Angeles")).toBe("US");
  });

  it("resolves English and Chinese region names via aliases", () => {
    expect(getCountryCodeFromRegion("China")).toBe("CN");
    expect(getCountryCodeFromRegion("中国")).toBe("CN");
    expect(getCountryCodeFromRegion("United States")).toBe("US");
    expect(getCountryCodeFromRegion("uk")).toBe("GB");
  });

  it("accepts a whole-string ISO code", () => {
    expect(getCountryCodeFromRegion("JP")).toBe("JP");
    expect(getCountryCodeFromRegion("UK")).toBe("GB");
  });

  it("still extracts an embedded ISO code from free text", () => {
    expect(getCountryCodeFromRegion("DE Frankfurt")).toBe("DE");
  });

  it("prefers a real alias over a stray uppercase token (regression)", () => {
    // "hong kong" must resolve to HK rather than being shadowed by a loose
    // 2-letter regex match elsewhere in the string.
    expect(getCountryCodeFromRegion("Hong Kong")).toBe("HK");
  });

  it("returns null for unknown input", () => {
    expect(getCountryCodeFromRegion("")).toBeNull();
    expect(getCountryCodeFromRegion(null)).toBeNull();
    expect(getDisplayRegionCode("totally-unknown-place")).toBe("UN");
  });
});
