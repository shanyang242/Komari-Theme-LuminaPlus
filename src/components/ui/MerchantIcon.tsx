import { useEffect, useState } from "react";
import { Store } from "lucide-react";
import { sanitizeMerchantIconUrl } from "@/utils/merchantLinks";

export function MerchantIcon({
  iconUrl,
  enabled,
  size = 15,
}: {
  iconUrl?: string;
  enabled: boolean;
  size?: number;
}) {
  const safeIconUrl = sanitizeMerchantIconUrl(iconUrl);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [safeIconUrl]);

  if (!enabled || !safeIconUrl || failed) {
    return <Store size={size} strokeWidth={2} aria-hidden />;
  }

  return (
    <img
      src={safeIconUrl}
      alt=""
      width={size}
      height={size}
      className="merchant-link-icon"
      onError={() => setFailed(true)}
    />
  );
}
