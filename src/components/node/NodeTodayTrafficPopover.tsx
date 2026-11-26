import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
  type FocusEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp, BarChart3, RefreshCw } from "lucide-react";
import {
  useNodeTodayTraffic,
  type NodeTodayTrafficView,
} from "@/hooks/useTodayTrafficStats";
import { useFineHover } from "@/hooks/useMediaQuery";
import { formatBytes, formatByteRateLabel, formatClockTime } from "@/utils/format";
import {
  consumeTriggerFocusSuppression,
  INITIAL_NODE_TODAY_TRAFFIC_POPOVER_STATE,
  isNodeTodayTrafficPopoverOpen,
  nodeTodayTrafficPopoverReducer,
} from "./nodeTodayTrafficPopoverState";

const POPOVER_WIDTH = 248;
const POPOVER_GAP = 8;
const VIEWPORT_PADDING = 8;
const HOVER_CLOSE_DELAY_MS = 160;

/**
 * 卡片上的「今日流量与峰值」入口：桌面悬浮、触屏点按，都通过 portal 渲染到
 * document.body，避免被卡片的 overflow:hidden 裁剪。数据只在弹层实际打开时激活，
 * 由 NodeGrid 的 TodayTrafficStatsProvider 按活跃节点分别查询并复用缓存。
 */
export function NodeTodayTrafficPopover({
  uuid,
  size = 15,
}: {
  uuid: string;
  size?: number;
}) {
  const traffic = useNodeTodayTraffic(uuid);
  const trafficAvailable = traffic.available;
  const setTrafficActive = traffic.setActive;
  const fineHover = useFineHover();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<number | null>(null);
  const focusCheckFrameRef = useRef<number | null>(null);
  const focusPopoverOnOpenRef = useRef(false);
  const suppressNextTriggerFocusRef = useRef(false);
  const [state, dispatch] = useReducer(
    nodeTodayTrafficPopoverReducer,
    INITIAL_NODE_TODAY_TRAFFIC_POPOVER_STATE,
  );
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const open = isNodeTodayTrafficPopoverOpen(state);

  const cancelClose = useCallback(() => {
    if (closeTimerRef.current != null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const cancelFocusCheck = useCallback(() => {
    if (focusCheckFrameRef.current != null) {
      window.cancelAnimationFrame(focusCheckFrameRef.current);
      focusCheckFrameRef.current = null;
    }
  }, []);

  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimerRef.current = window.setTimeout(() => {
      dispatch({ type: "hover-close" });
    }, HOVER_CLOSE_DELAY_MS);
  }, [cancelClose]);

  const openOnHover = useCallback(() => {
    cancelClose();
    dispatch({ type: "hover-open" });
  }, [cancelClose]);

  const scheduleFocusCheck = useCallback(() => {
    cancelFocusCheck();
    focusCheckFrameRef.current = window.requestAnimationFrame(() => {
      focusCheckFrameRef.current = null;
      const active = document.activeElement;
      const stillInside =
        active != null &&
        (triggerRef.current?.contains(active) || popoverRef.current?.contains(active));
      dispatch({ type: stillInside ? "focus-enter" : "focus-leave" });
    });
  }, [cancelFocusCheck]);

  const handleTriggerFocus = useCallback((event: FocusEvent<HTMLButtonElement>) => {
    // Esc 恢复按钮焦点只保留可见焦点，不应再次打开刚关闭的弹层。
    if (consumeTriggerFocusSuppression(suppressNextTriggerFocusRef)) return;
    // 指针点击造成的 focus 不参与打开状态；键盘 focus 则把焦点主动送入 portal。
    if (!event.currentTarget.matches(":focus-visible")) return;
    cancelClose();
    focusPopoverOnOpenRef.current = true;
    dispatch({ type: "focus-enter" });
  }, [cancelClose]);

  const handlePopoverFocus = useCallback(() => {
    cancelClose();
    dispatch({ type: "focus-enter" });
  }, [cancelClose]);

  const handleClick = useCallback(() => {
    cancelClose();
    focusPopoverOnOpenRef.current = false;
    const closingPinnedPopover = state.pinned;
    dispatch({ type: "toggle-pin" });
    if (closingPinnedPopover) triggerRef.current?.blur();
  }, [cancelClose, state.pinned]);

  useEffect(
    () => () => {
      cancelClose();
      cancelFocusCheck();
    },
    [cancelClose, cancelFocusCheck],
  );

  const wasActiveRef = useRef(false);
  useEffect(() => {
    if (!trafficAvailable) {
      if (wasActiveRef.current) {
        wasActiveRef.current = false;
        setTrafficActive(false);
      }
      return;
    }
    if (!open) {
      if (wasActiveRef.current) {
        wasActiveRef.current = false;
        setTrafficActive(false);
      }
      return;
    }
    wasActiveRef.current = true;
    setTrafficActive(true);
    return () => {
      wasActiveRef.current = false;
      setTrafficActive(false);
    };
  }, [open, setTrafficActive, trafficAvailable]);

  useEffect(() => {
    if (!open || !focusPopoverOnOpenRef.current) return;
    focusPopoverOnOpenRef.current = false;
    const frame = window.requestAnimationFrame(() => {
      popoverRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  // 定位：优先弹出在触发按钮下方，空间不足时翻到上方；左右按视口边缘收敛。
  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    const trigger = triggerRef.current;
    if (!trigger) return;
    const update = () => {
      const rect = trigger.getBoundingClientRect();
      const width = popoverRef.current?.offsetWidth || POPOVER_WIDTH;
      const height = popoverRef.current?.offsetHeight ?? 0;
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
    const frame = window.requestAnimationFrame(update);
    return () => window.cancelAnimationFrame(frame);
  }, [open, traffic.dataUpdatedAt, traffic.isError, traffic.isPending, traffic.stat]);

  // 打开期间：点击外部 / Esc / 滚动 / 缩放时关闭，避免弹层残留或位置过期。
  useEffect(() => {
    if (!open) return;
    const handleClose = () => {
      cancelClose();
      focusPopoverOnOpenRef.current = false;
      dispatch({ type: "close-all" });
    };
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (
        target &&
        (triggerRef.current?.contains(target) || popoverRef.current?.contains(target))
      ) {
        return;
      }
      handleClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const restoreTriggerFocus = popoverRef.current?.contains(document.activeElement);
      handleClose();
      if (restoreTriggerFocus) {
        suppressNextTriggerFocusRef.current = true;
        window.requestAnimationFrame(() => {
          const trigger = triggerRef.current;
          if (!trigger) {
            suppressNextTriggerFocusRef.current = false;
            return;
          }
          trigger.focus();
        });
      }
    };
    window.addEventListener("resize", handleClose);
    window.addEventListener("scroll", handleClose, { capture: true, passive: true });
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("resize", handleClose);
      window.removeEventListener("scroll", handleClose, { capture: true });
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [cancelClose, open]);

  if (!traffic.available) return null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="node-traffic-trigger"
        aria-label="今日流量与峰值"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={handleClick}
        onPointerEnter={fineHover ? openOnHover : undefined}
        onPointerLeave={fineHover ? scheduleClose : undefined}
        onFocus={handleTriggerFocus}
        onBlur={scheduleFocusCheck}
      >
        <BarChart3 size={size} strokeWidth={2.1} />
      </button>
      {open &&
        createPortal(
          <div
            ref={popoverRef}
            className="node-traffic-popover"
            role="dialog"
            aria-label="今日流量与峰值"
            tabIndex={-1}
            style={
              position
                ? { top: position.top, left: position.left }
                : { top: 0, left: 0, visibility: "hidden" }
            }
            onFocusCapture={handlePopoverFocus}
            onBlurCapture={scheduleFocusCheck}
            onPointerEnter={fineHover ? openOnHover : undefined}
            onPointerLeave={fineHover ? scheduleClose : undefined}
          >
            <TodayTrafficPopoverBody traffic={traffic} />
          </div>,
          document.body,
        )}
    </>
  );
}

function TodayTrafficPopoverBody({ traffic }: { traffic: NodeTodayTrafficView }) {
  const {
    stat,
    isPending,
    isError,
    isFetching,
    source,
    dataUpdatedAt,
    refetch,
  } = traffic;

  if (isPending && !stat) {
    return <div className="node-traffic-popover-empty">正在加载今日流量…</div>;
  }

  if (isError && !stat) {
    return (
      <div className="node-traffic-popover-error">
        <span>今日流量加载失败</span>
        <button
          type="button"
          className={`node-traffic-popover-retry${isFetching ? " is-spinning" : ""}`}
          onClick={() => void refetch()}
          disabled={isFetching}
          aria-busy={isFetching}
        >
          <RefreshCw size={11} strokeWidth={2.3} />
          重试
        </button>
      </div>
    );
  }

  if (!stat || !stat.hasSamples) {
    return (
      <>
        {isError && (
          <TrafficRefreshError isFetching={isFetching} refetch={refetch} />
        )}
        <div className="node-traffic-popover-empty">今日暂无采样数据</div>
      </>
    );
  }

  return (
    <>
      {isError && (
        <TrafficRefreshError isFetching={isFetching} refetch={refetch} />
      )}
      <div className="node-traffic-popover-head">
        <span>今日流量</span>
        {source === "records" && (
          <span className="node-traffic-popover-badge">兼容模式</span>
        )}
      </div>
      <div className="node-traffic-popover-rows">
        <PopoverRow
          icon={<ArrowUp size={12} strokeWidth={2.4} />}
          label="上行"
          value={formatBytes(stat.trafficUp)}
        />
        <PopoverRow
          icon={<ArrowDown size={12} strokeWidth={2.4} />}
          label="下行"
          value={formatBytes(stat.trafficDown)}
        />
      </div>
      <div className="node-traffic-popover-head is-peak">峰值速度</div>
      <div className="node-traffic-popover-rows">
        <PopoverRow
          icon={<ArrowUp size={12} strokeWidth={2.4} />}
          label="上行"
          value={formatByteRateLabel(stat.peakUp)}
          note={
            stat.peakUp > 0 && stat.peakUpAt != null
              ? formatClockTime(stat.peakUpAt)
              : undefined
          }
        />
        <PopoverRow
          icon={<ArrowDown size={12} strokeWidth={2.4} />}
          label="下行"
          value={formatByteRateLabel(stat.peakDown)}
          note={
            stat.peakDown > 0 && stat.peakDownAt != null
              ? formatClockTime(stat.peakDownAt)
              : undefined
          }
        />
      </div>
      <div className="node-traffic-popover-foot">
        <span>
          {source === "records" ? "按记录采样" : "按 5 分钟采样"} · 更新{" "}
          {formatClockTime(dataUpdatedAt)}
        </span>
        <Link to="/traffic" className="node-traffic-popover-link">
          明细
        </Link>
      </div>
    </>
  );
}

function TrafficRefreshError({
  isFetching,
  refetch,
}: {
  isFetching: boolean;
  refetch: () => Promise<unknown>;
}) {
  return (
    <div className="node-traffic-popover-error is-stale" role="alert">
      <span>更新失败，当前为缓存数据</span>
      <button
        type="button"
        className={`node-traffic-popover-retry${isFetching ? " is-spinning" : ""}`}
        onClick={() => void refetch()}
        disabled={isFetching}
        aria-busy={isFetching}
        aria-label="重试更新今日流量"
        title="重试"
      >
        <RefreshCw size={11} strokeWidth={2.3} />
      </button>
    </div>
  );
}

function PopoverRow({
  icon,
  label,
  value,
  note,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="node-traffic-popover-row">
      <span className="node-traffic-popover-label">
        {icon}
        {label}
      </span>
      <span className="node-traffic-popover-values">
        <strong className="tabular">{value}</strong>
        {note && <small>{note}</small>}
      </span>
    </div>
  );
}
