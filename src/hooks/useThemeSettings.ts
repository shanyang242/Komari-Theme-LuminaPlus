import { useMemo } from "react";
import { usePublicConfig } from "@/hooks/usePublicConfig";
import { normalizeThemeSettings } from "@/utils/themeSettings";

export function useThemeSettings() {
  const { data: config } = usePublicConfig();
  return useMemo(
    () => normalizeThemeSettings(config?.theme_settings),
    [config?.theme_settings],
  );
}
