import { memo, useState } from "react";

interface OsConfig {
  name: string;
  image: string;
  keywords: string[];
}

const OS_NAME_SPLIT_REGEX = /[\s/]+/;

const OS_CONFIGS: OsConfig[] = [
  {
    name: "AlmaLinux",
    image: "/images/logo/os-alma.svg",
    keywords: ["alma", "almalinux"],
  },
  {
    name: "Alpine Linux",
    image: "/images/logo/os-alpine.webp",
    keywords: ["alpine", "alpine linux"],
  },
  {
    name: "Armbian",
    image: "/images/logo/os-armbian.svg",
    keywords: ["armbian"],
  },
  {
    name: "CentOS",
    image: "/images/logo/os-centos.svg",
    keywords: ["centos", "cent os"],
  },
  {
    name: "Debian",
    image: "/images/logo/os-debian.svg",
    keywords: ["debian", "deb"],
  },
  {
    name: "FreeBSD",
    image: "/images/logo/os-freebsd.svg",
    keywords: ["freebsd", "bsd"],
  },
  {
    name: "Ubuntu",
    image: "/images/logo/os-ubuntu.svg",
    keywords: ["ubuntu", "elementary"],
  },
  {
    name: "Windows",
    image: "/images/logo/os-windows.svg",
    keywords: ["windows", "win", "microsoft", "ms"],
  },
  {
    name: "Arch Linux",
    image: "/images/logo/os-arch.svg",
    keywords: ["arch", "archlinux", "arch linux"],
  },
  {
    name: "Kali Linux",
    image: "/images/logo/os-kail.svg",
    keywords: ["kail", "kali", "kali linux"],
  },
  {
    name: "iStoreOS",
    image: "/images/logo/os-istore.png",
    keywords: ["istore", "istoreos", "istore os"],
  },
  {
    name: "OpenWrt",
    image: "/images/logo/os-openwrt.svg",
    keywords: ["openwrt", "open wrt", "open-wrt", "qwrt"],
  },
  {
    name: "ImmortalWrt",
    image: "/images/logo/os-openwrt.svg",
    keywords: ["immortalwrt", "immortal", "emmortal"],
  },
  {
    name: "NixOS",
    image: "/images/logo/os-nix.svg",
    keywords: ["nixos", "nix os", "nix"],
  },
  {
    name: "Rocky Linux",
    image: "/images/logo/os-rocky.svg",
    keywords: ["rocky", "rocky linux"],
  },
  {
    name: "Fedora",
    image: "/images/logo/os-fedora.svg",
    keywords: ["fedora"],
  },
  {
    name: "openSUSE",
    image: "/images/logo/os-openSUSE.svg",
    keywords: ["opensuse", "suse"],
  },
  {
    name: "Gentoo",
    image: "/images/logo/os-gentoo.svg",
    keywords: ["gentoo"],
  },
  {
    name: "Red Hat",
    image: "/images/logo/os-redhat.svg",
    keywords: ["redhat", "rhel", "red hat"],
  },
  {
    name: "Linux Mint",
    image: "/images/logo/os-mint.svg",
    keywords: ["mint", "linux mint"],
  },
  {
    name: "Manjaro",
    image: "/images/logo/os-manjaro-.svg",
    keywords: ["manjaro"],
  },
  {
    name: "Synology DSM",
    image: "/images/logo/os-synology.ico",
    keywords: ["synology", "dsm", "synology dsm"],
  },
  {
    name: "fnOS",
    image: "/images/logo/os-fnos.png",
    keywords: ["fnos", "fnnas"],
  },
  {
    name: "Proxmox VE",
    image: "/images/logo/os-proxmox.ico",
    keywords: ["proxmox", "proxmox ve"],
  },
  {
    name: "macOS",
    image: "/images/logo/os-macos.svg",
    keywords: ["macos", "mac os", "mac os x", "osx", "darwin"],
  },
  {
    name: "QTS",
    image: "/images/logo/os-qnap.svg",
    keywords: ["qts", "quts hero", "qes", "qutscloud"],
  },
  {
    name: "Astra Linux",
    image: "/images/logo/os-astar.png",
    keywords: ["astra", "astra linux"],
  },
  {
    name: "Orange Pi",
    image: "/images/logo/os-orange-pi.svg",
    keywords: ["orange pi", "orangepi"],
  },
  {
    name: "Huawei",
    image: "/images/logo/os-huawei.svg",
    keywords: ["huawei", "euleros", "euler os"],
  },
  {
    name: "Aliyun",
    image: "/images/logo/alibabacloud-color.svg",
    keywords: ["aliyun", "alibaba"],
  },
  {
    name: "OpenCloudOS",
    image: "/images/logo/os-OpenCloudOS.png",
    keywords: ["opencloud"],
  },
  {
    name: "Unraid",
    image: "/images/logo/os-unraid.svg",
    keywords: ["unraid"],
  },
];

const DEFAULT_OS_CONFIG: OsConfig = {
  name: "Linux",
  image: "/images/logo/linux.svg",
  keywords: ["unknown"],
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const OS_MATCHERS = OS_CONFIGS.map((config) => ({
  config,
  matcher: new RegExp(`\\b(?:${config.keywords.map(escapeRegExp).join("|")})\\b`),
}));

function findOsConfig(osString?: string | null): OsConfig {
  if (!osString) {
    return DEFAULT_OS_CONFIG;
  }

  const normalizedInput = osString.toLowerCase().trim();
  for (const { config, matcher } of OS_MATCHERS) {
    if (matcher.test(normalizedInput)) {
      return config;
    }
  }

  return DEFAULT_OS_CONFIG;
}

const OS_INFO_CACHE_LIMIT = 512;
const osInfoCache = new Map<string, OsConfig>();

export function resolveOsInfo(value?: string | null): OsConfig {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return DEFAULT_OS_CONFIG;

  const cached = osInfoCache.get(trimmed);
  if (cached) return cached;

  const config = findOsConfig(trimmed);
  const resolved =
    config !== DEFAULT_OS_CONFIG
      ? config
      : {
          ...DEFAULT_OS_CONFIG,
          name: trimmed.split(OS_NAME_SPLIT_REGEX)[0] || DEFAULT_OS_CONFIG.name,
        };
  if (osInfoCache.size >= OS_INFO_CACHE_LIMIT) osInfoCache.clear();
  osInfoCache.set(trimmed, resolved);
  return resolved;
}

export const OsLogo = memo(function OsLogo({
  value,
  size = 18,
}: {
  value?: string | null;
  size?: number;
}) {
  const os = resolveOsInfo(value);
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const src = failedImage === os.image ? DEFAULT_OS_CONFIG.image : os.image;

  return (
    <img
      className="os-logo"
      src={src}
      alt={os.name}
      title={os.name}
      width={size}
      height={size}
      loading="lazy"
      draggable={false}
      onError={() => {
        if (src !== DEFAULT_OS_CONFIG.image) setFailedImage(os.image);
      }}
      style={{ "--os-logo-size": `${size}px` } as React.CSSProperties}
    />
  );
});
