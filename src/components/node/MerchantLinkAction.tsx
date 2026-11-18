import { clsx } from "clsx";
import { MerchantIcon } from "@/components/ui/MerchantIcon";
import {
  resolveMerchantIconUrl,
  resolveMerchantLinkUrl,
  type NodeMerchantLink,
} from "@/utils/merchantLinks";

export function MerchantLinkAction({
  link,
  className,
}: {
  link?: NodeMerchantLink;
  className: string;
}) {
  const url = resolveMerchantLinkUrl(link?.url);
  const icon = (
    <MerchantIcon
      enabled={Boolean(url)}
      iconUrl={url ? resolveMerchantIconUrl(link?.iconUrl) : ""}
      size={15}
    />
  );

  if (!url) {
    return (
      <span
        className={clsx(className, "merchant-link-action is-disabled")}
        title="未配置商家官网"
        aria-label="未配置商家官网"
      >
        {icon}
      </span>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={clsx(className, "merchant-link-action")}
      title="打开商家官网"
      aria-label="在新标签页打开商家官网"
    >
      {icon}
    </a>
  );
}
