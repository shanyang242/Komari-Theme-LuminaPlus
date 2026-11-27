import { describe, expect, it } from "vitest";
import {
  getMerchantLinkErrors,
  hasInvalidMerchantLinks,
  normalizeNodeMerchantLinks,
} from "@/utils/merchantLinks";

describe("merchant link draft validation", () => {
  it("keeps malformed nonempty drafts invalid even when their normalized payload is empty", () => {
    const links = { node: { url: "example.com", iconUrl: "" } };
    expect(normalizeNodeMerchantLinks(links)).toEqual({});
    expect(hasInvalidMerchantLinks(links)).toBe(true);
    expect(getMerchantLinkErrors(links.node).url).toContain("https://");
  });

  it("accepts clearing fields, HTTP(S) merchant links and relative icons", () => {
    expect(hasInvalidMerchantLinks({})).toBe(false);
    expect(hasInvalidMerchantLinks({ node: { url: "  ", iconUrl: "" } })).toBe(false);
    expect(hasInvalidMerchantLinks({ node: { url: "https://example.com", iconUrl: "/assets/logo.svg" } })).toBe(false);
  });

  it.each(["//cdn.example.com/logo.png", "data:image/png;base64,AAAA", "javascript:alert(1)"])(
    "reports a rejected icon instead of silently removing %s",
    (iconUrl) => {
      const link = { url: "https://example.com", iconUrl };
      expect(getMerchantLinkErrors(link).url).toBeNull();
      expect(getMerchantLinkErrors(link).iconUrl).not.toBeNull();
      expect(hasInvalidMerchantLinks({ node: link })).toBe(true);
    },
  );
});
