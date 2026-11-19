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
    expect(getCountryCodeFromRegion("jp")).toBe("JP");
    expect(getCountryCodeFromRegion("UK")).toBe("GB");
  });

  it.each([
    ["XK", "🇽🇰"],
    ["DG", "🇩🇬"],
  ])("resolves %s consistently as text and emoji", (code, flag) => {
    expect(getCountryCodeFromRegion(code)).toBe(code);
    expect(getCountryCodeFromRegion(code.toLowerCase())).toBe(code);
    expect(getCountryCodeFromRegion(flag)).toBe(code);
    expect(getDisplayRegionCode(code)).toBe(getDisplayRegionCode(flag));
  });

  it("still extracts an embedded ISO code from free text", () => {
    expect(getCountryCodeFromRegion("DE Frankfurt")).toBe("DE");
  });

  it("prefers a real alias over a stray uppercase token (regression)", () => {
    // "hong kong" 要解析成 HK,不能被串里别处一个松散的两字母正则匹配抢先盖掉
    expect(getCountryCodeFromRegion("Hong Kong")).toBe("HK");
  });

  it("returns null for unknown input", () => {
    expect(getCountryCodeFromRegion("")).toBeNull();
    expect(getCountryCodeFromRegion(null)).toBeNull();
    expect(getDisplayRegionCode("totally-unknown-place")).toBe("UN");
  });

  it("rejects stray 2-letter words that are not real ISO codes (regression)", () => {
    expect(getCountryCodeFromRegion("GO Cloud")).toBeNull();
    expect(getDisplayRegionCode("GO Cloud")).toBe("UN");
    expect(getCountryCodeFromRegion("My Server")).toBeNull();
    expect(getCountryCodeFromRegion("server in Frankfurt")).toBeNull();
    expect(getCountryCodeFromRegion("No region selected")).toBeNull();
  });

  it("still resolves a valid embedded code, even after a stray token", () => {
    expect(getCountryCodeFromRegion("SE Stockholm")).toBe("SE");
    expect(getCountryCodeFromRegion("GO HK")).toBe("HK");
  });
});
