import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  INITIAL_NODE_TODAY_TRAFFIC_POPOVER_STATE,
  isNodeTodayTrafficPopoverOpen,
  nodeTodayTrafficPopoverReducer,
} from "@/components/node/nodeTodayTrafficPopoverState";

const POPOVER_GAP = 8;
const VIEWPORT_PADDING = 8;
const HOVER_CLOSE_DELAY_MS = 160;

export interface AnchoredPopoverPosition {
  top: number;
  left: number;
}

/**
 * 锚定在触发元素上的浮层：桌面悬停、触屏点按，位置随视口翻转并收敛到边界内，
 * 打开期间点击外部 / Esc / 滚动 / 缩放都会关闭。
 *
 * 开关状态机复用 NodeTodayTrafficPopover 那套 hover/pinned/focus 三态 reducer——
 * 它本身与「今日流量」无关，是纯粹的浮层开关语义。
 */
export function useAnchoredPopover<
  Trigger extends HTMLElement,
  Surface extends HTMLElement,
>({ fallbackWidth }: { fallbackWidth: number }) {
  const triggerRef = useRef<Trigger>(null);
  const surfaceRef = useRef<Surface>(null);
  const closeTimerRef = useRef<number | null>(null);
  const [state, dispatch] = useReducer(
    nodeTodayTrafficPopoverReducer,
    INITIAL_NODE_TODAY_TRAFFIC_POPOVER_STATE,
  );
  const [position, setPosition] = useState<AnchoredPopoverPosition | null>(null);
  const open = isNodeTodayTrafficPopoverOpen(state);

  const cancelClose = useCallback(() => {
    if (closeTimerRef.current != null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const openOnHover = useCallback(() => {
    cancelClose();
    dispatch({ type: "hover-open" });
  }, [cancelClose]);

  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimerRef.current = window.setTimeout(() => {
      dispatch({ type: "hover-close" });
    }, HOVER_CLOSE_DELAY_MS);
  }, [cancelClose]);

  const togglePinned = useCallback(() => {
    cancelClose();
    dispatch({ type: "toggle-pin" });
  }, [cancelClose]);

  useEffect(() => () => cancelClose(), [cancelClose]);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    const trigger = triggerRef.current;
    if (!trigger) return;
    const update = () => {
      const rect = trigger.getBoundingClientRect();
      const width = surfaceRef.current?.offsetWidth || fallbackWidth;
      const height = surfaceRef.current?.offsetHeight ?? 0;
      const belowTop = rect.bottom + POPOVER_GAP;
      const top =
        belowTop + height > window.innerHeight - VIEWPORT_PADDING
          ? Math.max(VIEWPORT_PADDING, rect.top - height - POPOVER_GAP)
          : belowTop;
      const left = Math.min(
        Math.max(VIEWPORT_PADDING, rect.left + rect.width / 2 - width / 2),
        Math.max(VIEWPORT_PADDING, window.innerWidth - width - VIEWPORT_PADDING),
      );
      setPosition({ top, left });
    };
    update();
    // 首帧浮层还没测量到真实尺寸，下一帧用实际宽高再定位一次。
    const frame = window.requestAnimationFrame(update);
    return () => window.cancelAnimationFrame(frame);
  }, [fallbackWidth, open]);

  useEffect(() => {
    if (!open) return;
    const closeAll = () => {
      cancelClose();
      dispatch({ type: "close-all" });
    };
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (
        target &&
        (triggerRef.current?.contains(target) || surfaceRef.current?.contains(target))
      ) {
        return;
      }
      closeAll();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeAll();
    };
    window.addEventListener("resize", closeAll);
    window.addEventListener("scroll", closeAll, { capture: true, passive: true });
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("resize", closeAll);
      window.removeEventListener("scroll", closeAll, { capture: true });
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [cancelClose, open]);

  return {
    open,
    position,
    triggerRef,
    surfaceRef,
    openOnHover,
    scheduleClose,
    togglePinned,
  };
}
