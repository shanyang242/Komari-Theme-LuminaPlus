import { useEffect, useState } from "react";
import { Store } from "lucide-react";

export function MerchantIcon({
  iconUrl,
  enabled,
  size = 15,
}: {
  iconUrl?: string;
  enabled: boolean;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [iconUrl]);

  if (!enabled || !iconUrl || failed) {
    return <Store size={size} strokeWidth={2} aria-hidden />;
  }

  return (
    <img
      src={iconUrl}
      alt=""
      width={size}
      height={size}
      className="merchant-link-icon"
      onError={() => setFailed(true)}
    />
  );
}
