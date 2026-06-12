import { useEffect } from "react";
import { usePublicConfig } from "@/hooks/usePublicConfig";

const FALLBACK_TITLE = "komaritheme";
const FALLBACK_DESCRIPTION = "A Komari monitor theme.";

function updateMeta(selector: string, attr: "content", value: string) {
  const element = document.querySelector<HTMLMetaElement>(selector);
  if (element) {
    element[attr] = value;
  }
}

export function useSiteMetadata() {
  const { data: config } = usePublicConfig();

  useEffect(() => {
    const siteName = config?.sitename?.trim() || FALLBACK_TITLE;
    const description = config?.description?.trim() || FALLBACK_DESCRIPTION;

    document.title = siteName;
    updateMeta('meta[name="apple-mobile-web-app-title"]', "content", siteName);
    updateMeta('meta[property="og:title"]', "content", siteName);
    updateMeta('meta[name="twitter:title"]', "content", siteName);
    updateMeta('meta[name="description"]', "content", description);
    updateMeta('meta[property="og:description"]', "content", description);
    updateMeta('meta[name="twitter:description"]', "content", description);
  }, [config?.sitename, config?.description]);
}
