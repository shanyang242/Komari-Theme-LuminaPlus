export const MOBILE_VIEWPORT_QUERY = "(max-width: 720px)";
export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** 订阅 MediaQueryList 的 `change` 事件并返回取消订阅函数。 */
export function subscribeMediaQuery(mq: MediaQueryList, handler: () => void): () => void {
  mq.addEventListener("change", handler);
  return () => mq.removeEventListener("change", handler);
}

const FINE_HOVER_QUERY = "(any-hover: hover) and (any-pointer: fine)";
let fineHoverMediaQuery: MediaQueryList | null = null;

function getFineHoverMediaQuery(): MediaQueryList | null {
  if (typeof window === "undefined" || !window.matchMedia) return null;
  fineHoverMediaQuery ??= window.matchMedia(FINE_HOVER_QUERY);
  return fineHoverMediaQuery;
}

/** 只让真正具备悬停能力的精细指针进入柱条 hover 交互；触摸输入始终排除。 */
export function supportsFineHover(pointerType?: string): boolean {
  if (pointerType === "touch") return false;
  return getFineHoverMediaQuery()?.matches ?? false;
}
