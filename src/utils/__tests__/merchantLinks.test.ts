import { describe, expect, it } from "vitest";
import {
  getMerchantLinkValidationErrors,
  hasInvalidNodeMerchantLinks,
  normalizeNodeMerchantLinks,
  readRawNodeMerchantLinks,
  resolveMerchantIconUrl,
  resolveMerchantLinkUrl,
} from "@/utils/merchantLinks";

describe("resolveMerchantLinkUrl", () => {
  it("supports bare domains with and without explicit ports", () => {
    expect(resolveMerchantLinkUrl("example.com")).toBe("https://example.com");
    expect(resolveMerchantLinkUrl("example.com:8443/shop")).toBe("https://example.com:8443/shop");
    expect(resolveMerchantLinkUrl("localhost:3000/panel")).toBe("https://localhost:3000/panel");
    expect(resolveMerchantLinkUrl("1.2.3.4:8080/buy")).toBe("https://1.2.3.4:8080/buy");
  });

  it("supports explicit http/https, protocol-relative, and site-relative paths", () => {
    expect(resolveMerchantLinkUrl("https://shop.example.com:8443/a")).toBe(
      "https://shop.example.com:8443/a",
    );
    expect(resolveMerchantLinkUrl("//shop.example.com/a")).toBe("https://shop.example.com/a");
    expect(resolveMerchantLinkUrl("/shop/node-1")).toBe("/shop/node-1");
    expect(resolveMerchantLinkUrl("./shop")).toBe("./shop");
  });

  it("rejects dangerous schemes, out-of-range ports, and malformed strings", () => {
    expect(resolveMerchantLinkUrl("javascript:alert(1)")).toBe("");
    expect(resolveMerchantLinkUrl("javascript:123")).toBe("");
    expect(resolveMerchantLinkUrl("data:text/html,1")).toBe("");
    expect(resolveMerchantLinkUrl("example.com:99999/shop")).toBe("");
    expect(resolveMerchantLinkUrl("http://")).toBe("");
    expect(resolveMerchantLinkUrl("not-a-valid-url")).toBe("");
    expect(resolveMerchantLinkUrl("https://bad host.com")).toBe("");
  });
});

describe("resolveMerchantIconUrl", () => {
  it("preserves legacy relative icon paths alongside http(s) and root-relative paths", () => {
    expect(resolveMerchantIconUrl("images/shop.svg")).toBe("images/shop.svg");
    expect(resolveMerchantIconUrl("assets/v1.2/logo.png")).toBe("assets/v1.2/logo.png");
    expect(resolveMerchantIconUrl("/images/shop.svg")).toBe("/images/shop.svg");
    expect(resolveMerchantIconUrl("./logo.svg")).toBe("./logo.svg");
    expect(resolveMerchantIconUrl("https://cdn.example.com:8443/logo.png")).toBe(
      "https://cdn.example.com:8443/logo.png",
    );
  });

  it("rejects unsafe schemes and broken URLs", () => {
    expect(resolveMerchantIconUrl("javascript:alert(1)")).toBe("");
    expect(resolveMerchantIconUrl("data:image/svg+xml,<svg/>")).toBe("");
    expect(resolveMerchantIconUrl("http://")).toBe("");
    expect(resolveMerchantIconUrl("https/logo.png")).toBe("");
    expect(resolveMerchantIconUrl("images/bad icon.svg")).toBe("");
  });
});

describe("merchant link validation & raw draft preservation", () => {
  it("flags non-empty invalid inputs while allowing empty cleared fields", () => {
    expect(getMerchantLinkValidationErrors({ url: "", iconUrl: "" })).toEqual({
      urlError: null,
      iconUrlError: null,
    });
    expect(
      getMerchantLinkValidationErrors({
        url: "example.com:8443/shop",
        iconUrl: "images/shop.svg",
      }),
    ).toEqual({
      urlError: null,
      iconUrlError: null,
    });

    const invalid = getMerchantLinkValidationErrors({
      url: "not-a-url",
      iconUrl: "javascript:1",
    });
    expect(invalid.urlError).toBeTruthy();
    expect(invalid.iconUrlError).toBeTruthy();
    expect(
      hasInvalidNodeMerchantLinks({
        "node-1": { url: "not-a-url", iconUrl: "" },
      }),
    ).toBe(true);
  });

  it("distinguishes raw legacy entries from active clearing", () => {
    const raw = readRawNodeMerchantLinks({
      "node-valid": { url: "example.com:8443/shop", iconUrl: "images/shop.svg" },
      "node-invalid": { url: "not-a-url", iconUrl: "" },
      "node-cleared": { url: "  ", iconUrl: "" },
    });
    expect(raw).toEqual({
      "node-valid": { url: "https://example.com:8443/shop", iconUrl: "images/shop.svg" },
      "node-invalid": { url: "not-a-url", iconUrl: "" },
    });
    expect(
      normalizeNodeMerchantLinks({
        "node-valid": { url: "example.com:8443/shop", iconUrl: "images/shop.svg" },
        "node-invalid": { url: "not-a-url", iconUrl: "" },
      }),
    ).toEqual({
      "node-valid": { url: "https://example.com:8443/shop", iconUrl: "images/shop.svg" },
    });
  });
});
