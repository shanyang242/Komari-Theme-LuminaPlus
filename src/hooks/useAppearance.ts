import { usePreferences } from "@/hooks/usePreferences";

// Mounting this hook ensures the preferences store is initialized and keeps the
// component subscribed to appearance changes. The DOM (data-appearance,
// color-scheme, theme-color) is applied centrally in usePreferences' commit(),
// so there is no separate DOM-writing effect here.
export function useAppearance() {
  return usePreferences().resolvedAppearance;
}
