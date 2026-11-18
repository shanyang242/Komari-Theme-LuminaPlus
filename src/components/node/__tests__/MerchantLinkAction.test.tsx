import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MerchantLinkAction } from "@/components/node/MerchantLinkAction";

describe("MerchantLinkAction", () => {
  it("shows a disabled default icon when no merchant URL is configured", () => {
    const html = renderToStaticMarkup(
      <MerchantLinkAction className="card-action" />,
    );

    expect(html).toContain("merchant-link-action is-disabled");
    expect(html).toContain("未配置商家官网");
    expect(html).not.toContain("href=");
  });

  it("opens a configured merchant URL in a new tab", () => {
    const html = renderToStaticMarkup(
      <MerchantLinkAction
        className="card-action"
        link={{
          url: "https://merchant.example.com",
          iconUrl: "https://cdn.example.com/logo.png",
        }}
      />,
    );

    expect(html).toContain('href="https://merchant.example.com"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('src="https://cdn.example.com/logo.png"');
  });

  it("blocks unsafe schemes and normalizes bare domains", () => {
    const unsafeHtml = renderToStaticMarkup(
      <MerchantLinkAction
        className="card-action"
        link={{ url: "javascript:alert(1)", iconUrl: "javascript:alert(2)" }}
      />,
    );
    expect(unsafeHtml).toContain("merchant-link-action is-disabled");
    expect(unsafeHtml).not.toContain("href=");

    const domainHtml = renderToStaticMarkup(
      <MerchantLinkAction
        className="card-action"
        link={{ url: "merchant.example.com:8443/store", iconUrl: "images/shop.svg" }}
      />,
    );
    expect(domainHtml).toContain('href="https://merchant.example.com:8443/store"');
    expect(domainHtml).toContain('src="images/shop.svg"');
  });
});
