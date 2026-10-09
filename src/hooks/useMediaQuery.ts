import { useCallback, useMemo, useSyncExternalStore } from "react";
import {
  subscribeFineHover,
  subscribeMediaQuery,
  supportsFineHover,
} from "@/utils/mediaQuery";

/** 订阅单个 CSS 媒体查询。 */
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

/** 所有节点卡片共享一套细指针媒体查询和一个原生 change 监听。 */
export function useFineHover() {
  return useSyncExternalStore(subscribeFineHover, supportsFineHover, () => false);
}
