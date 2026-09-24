export const MOBILE_VIEWPORT_QUERY = "(max-width: 720px)";
export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * 订阅 MediaQueryList 的 `change` 事件并返回取消订阅函数。Safari < 14 没在 MediaQueryList 上
 * 实现 addEventListener,故回退到已废弃的 addListener/removeListener。
 */
export function subscribeMediaQuery(mq: MediaQueryList, handler: () => void): () => void {
  if (typeof mq.addEventListener === "function") {
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }
  mq.addListener(handler);
  return () => mq.removeListener(handler);
}

const FINE_HOVER_QUERY = "(any-hover: hover) and (any-pointer: fine)";
let fineHoverMediaQuery: MediaQueryList | null = null;
let fineHoverMediaQueryUnsubscribe: (() => void) | null = null;
const fineHoverListeners = new Set<() => void>();

function getFineHoverMediaQuery(): MediaQueryList | null {
  if (typeof window === "undefined" || !window.matchMedia) return null;
  fineHoverMediaQuery ??= window.matchMedia(FINE_HOVER_QUERY);
  return fineHoverMediaQuery;
}

export function subscribeFineHover(listener: () => void): () => void {
  fineHoverListeners.add(listener);
  const mediaQuery = getFineHoverMediaQuery();
  if (mediaQuery && fineHoverListeners.size === 1) {
    fineHoverMediaQueryUnsubscribe = subscribeMediaQuery(mediaQuery, () => {
      for (const current of fineHoverListeners) current();
    });
  }
  return () => {
    fineHoverListeners.delete(listener);
    if (fineHoverListeners.size === 0) {
      fineHoverMediaQueryUnsubscribe?.();
      fineHoverMediaQueryUnsubscribe = null;
    }
  };
}

/** 只让真正具备悬停能力的精细指针进入柱条 hover 交互；触摸输入始终排除。 */
export function supportsFineHover(pointerType?: string): boolean {
  if (pointerType === "touch") return false;
  return getFineHoverMediaQuery()?.matches ?? false;
}
