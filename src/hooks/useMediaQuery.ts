import { useCallback, useMemo, useSyncExternalStore } from "react";
import { subscribeMediaQuery } from "@/utils/mediaQuery";

export function useMediaQuery(query: string, serverFallback = false) {
  const mediaQuery = useMemo(
    () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(query) : null),
    [query],
  );
  const subscribe = useCallback(
    (listener: () => void) =>
      mediaQuery ? subscribeMediaQuery(mediaQuery, listener) : () => undefined,
    [mediaQuery],
  );
  const getSnapshot = useCallback(() => mediaQuery?.matches ?? serverFallback, [mediaQuery, serverFallback]);
  const getServerSnapshot = useCallback(() => serverFallback, [serverFallback]);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
