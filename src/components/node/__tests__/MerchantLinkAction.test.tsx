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

  it("blocks dangerous protocols in merchant URL and icon while allowing site-relative icon paths", () => {
    const blockedHref = renderToStaticMarkup(
      <MerchantLinkAction
        className="card-action"
        link={{
          url: "javascript:alert(1)",
          iconUrl: "data:image/svg+xml,<svg/>",
        }}
      />,
    );
    expect(blockedHref).toContain("is-disabled");
    expect(blockedHref).not.toContain("javascript:");
    expect(blockedHref).not.toContain("data:");

    const relativeIcon = renderToStaticMarkup(
      <MerchantLinkAction
        className="card-action"
        link={{
          url: "https://merchant.example.com",
          iconUrl: "/assets/merchant.svg",
        }}
      />,
    );
    expect(relativeIcon).toContain('href="https://merchant.example.com"');
    expect(relativeIcon).toContain('src="/assets/merchant.svg"');
  });
});
