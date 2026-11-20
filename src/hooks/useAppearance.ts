import { usePreferences } from "@/hooks/usePreferences";

export function useAppearance() {
  return usePreferences().resolvedAppearance;
}
