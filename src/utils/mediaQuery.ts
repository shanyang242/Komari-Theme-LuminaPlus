export const MOBILE_VIEWPORT_QUERY = "(max-width: 720px)";
export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

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

/** 优先按当前指针类型判断，未知时回退媒体查询。 */
export function supportsFineHover(pointerType?: string): boolean {
  if (pointerType === "touch") return false;
  if (pointerType === "mouse" || pointerType === "pen") return true;
  return getFineHoverMediaQuery()?.matches ?? false;
}
