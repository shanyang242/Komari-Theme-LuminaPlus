import { useEffect, useMemo } from "react";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { usePreferences } from "@/hooks/usePreferences";
import { useThemeSettings } from "@/hooks/useThemeSettings";
import { applyBackgroundCache, buildBackgroundCache, persistBackgroundCache } from "@/utils/background";
import { MOBILE_VIEWPORT_QUERY } from "@/utils/mediaQuery";

/** 图片由 body 伪元素首帧绘制。 */
export function BackgroundLayer() {
  const { resolvedAppearance } = usePreferences();
  const { enableBackgroundImage, backgroundImage, backgroundImageMobile, backgroundAlignment, surfaceOpacity, isReady } = useThemeSettings();
  const isMobile = useMediaQuery(MOBILE_VIEWPORT_QUERY, true);
  const backgroundCache = useMemo(
    () => buildBackgroundCache({ enableBackgroundImage, backgroundImage, backgroundImageMobile, backgroundAlignment, surfaceOpacity }),
    [enableBackgroundImage, backgroundImage, backgroundImageMobile, backgroundAlignment, surfaceOpacity],
  );

  useEffect(() => {
    if (isReady) persistBackgroundCache(backgroundCache);
  }, [isReady, backgroundCache]);

  useEffect(() => {
    if (isReady) applyBackgroundCache(backgroundCache, resolvedAppearance, { isMobile });
  }, [isReady, backgroundCache, resolvedAppearance, isMobile]);

  return null;
}
