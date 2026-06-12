import { useEffect, useState } from "react";
import { getDisplayRegionCode } from "@/utils/geo";

interface FlagProps {
  region?: string | null;
  size?: number;
}

export function Flag({ region, size = 14 }: FlagProps) {
  const value = region?.trim() ?? "";
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    setLoadFailed(false);
  }, [value]);

  if (!value) {
    return (
      <span
        aria-hidden
        className="inline-block rounded-[3px] shrink-0"
        style={{
          width: size + 8,
          height: size,
          background: "var(--border-subtle)",
        }}
      />
    );
  }

  const flagCode = getDisplayRegionCode(value);
  const src = `/assets/flags/${flagCode}.svg`;
  const alt = `地区旗帜: ${flagCode}`;

  if (loadFailed) {
    return (
      <span
        aria-hidden
        className="inline-block rounded-[3px] shrink-0"
        title={alt}
        style={{
          width: size + 8,
          height: size,
          background: "var(--border-subtle)",
        }}
      />
    );
  }

  return (
    <span
      className="inline-flex items-center shrink-0"
      aria-label={alt}
      style={{
        width: size + 8,
        height: size,
        lineHeight: 0,
      }}
    >
      <img
        src={src}
        alt={alt}
        loading="lazy"
        style={{
          width: "100%",
          height: "100%",
          objectFit: "contain",
          display: "block",
        }}
        onError={() => setLoadFailed(true)}
      />
    </span>
  );
}
