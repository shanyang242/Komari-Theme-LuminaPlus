import { useEffect, useMemo, useRef, useState } from "react";
import { RotateCw } from "lucide-react";

const REFRESH_THRESHOLD = 56;
const MAX_PULL = 76;
const IGNORED_TARGETS =
  "input, textarea, select, [contenteditable='true'], [role='dialog'], .uplot, [data-no-pull-refresh], .metric-color-picker, .renewal-reminder-panel";

export type PullState = "idle" | "pulling" | "ready" | "refreshing" | "offline";

export function isIosStandalone(
  userAgent = navigator.userAgent,
  platform = navigator.platform,
  maxTouchPoints = navigator.maxTouchPoints,
  standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true,
  displayModeStandalone = window.matchMedia("(display-mode: standalone)").matches,
) {
  const ios = /iP(?:hone|ad|od)/.test(userAgent) || (platform === "MacIntel" && maxTouchPoints > 1);
  return ios && (standalone || displayModeStandalone);
}

export function attachPwaPullToRefresh({
  doc,
  win,
  nav,
  onStateChange,
  onDistanceChange,
  onReload,
}: {
  doc: Pick<Document, "addEventListener" | "removeEventListener">;
  win: Pick<Window, "scrollY" | "setTimeout" | "clearTimeout">;
  nav: Pick<Navigator, "onLine">;
  onStateChange: (state: PullState) => void;
  onDistanceChange: (distance: number) => void;
  onReload: () => void;
}) {
  let state: PullState = "idle";
  let distance = 0;
  let start = { x: 0, y: 0 };
  let tracking = false;
  let reloadTimer: number | null = null;

  const clearTimer = () => {
    if (reloadTimer != null) {
      win.clearTimeout(reloadTimer);
      reloadTimer = null;
    }
  };
  const update = (nextState: PullState, nextDistance: number) => {
    if (distance !== nextDistance) {
      distance = nextDistance;
      onDistanceChange(nextDistance);
    }
    if (state !== nextState) {
      state = nextState;
      onStateChange(nextState);
    }
  };
  const reset = () => {
    clearTimer();
    tracking = false;
    update("idle", 0);
  };
  const onTouchStart = (event: TouchEvent) => {
    if (tracking && event.touches.length > 1) {
      reset();
      return;
    }
    if (state !== "idle" || event.touches.length !== 1 || win.scrollY > 0) return;
    const target =
      typeof Element !== "undefined" && event.target instanceof Element ? event.target : null;
    if (target?.closest(IGNORED_TARGETS)) return;
    const touch = event.touches[0];
    if (!touch) return;
    start = { x: touch.clientX, y: touch.clientY };
    tracking = true;
    distance = 0;
  };
  const onTouchMove = (event: TouchEvent) => {
    if (!tracking) return;
    if (event.touches.length !== 1) {
      reset();
      return;
    }
    const touch = event.touches[0];
    if (!touch) {
      reset();
      return;
    }
    const dx = Math.abs(touch.clientX - start.x);
    const dy = touch.clientY - start.y;
    if (dy <= 0 || dx > dy || win.scrollY > 0) {
      reset();
      return;
    }
    if (dy < 6) return;
    if (event.cancelable) event.preventDefault();
    const nextDistance = Math.min(MAX_PULL, dy * 0.65);
    update(nextDistance >= REFRESH_THRESHOLD ? "ready" : "pulling", nextDistance);
  };
  const onTouchEnd = (event: TouchEvent) => {
    if (!tracking) return;
    if (event.touches.length > 0) {
      reset();
      return;
    }
    tracking = false;
    if (distance < REFRESH_THRESHOLD) {
      reset();
      return;
    }
    clearTimer();
    if (!nav.onLine) {
      update("offline", REFRESH_THRESHOLD);
      reloadTimer = win.setTimeout(reset, 1_200);
      return;
    }
    update("refreshing", REFRESH_THRESHOLD);
    reloadTimer = win.setTimeout(() => {
      reloadTimer = null;
      onReload();
    }, 180);
  };

  doc.addEventListener("touchstart", onTouchStart, { passive: true });
  doc.addEventListener("touchmove", onTouchMove, { passive: false });
  doc.addEventListener("touchend", onTouchEnd, { passive: true });
  doc.addEventListener("touchcancel", reset, { passive: true });
  return () => {
    doc.removeEventListener("touchstart", onTouchStart);
    doc.removeEventListener("touchmove", onTouchMove);
    doc.removeEventListener("touchend", onTouchEnd);
    doc.removeEventListener("touchcancel", reset);
    reset();
  };
}

function applyPullStyle(element: HTMLDivElement | null, distance: number) {
  if (!element) return;
  const progress = Math.min(1, distance / REFRESH_THRESHOLD);
  element.style.setProperty("--pull-refresh-progress", String(progress));
  element.style.setProperty("--pull-refresh-y", `${Math.min(10, -38 + distance * 0.8)}px`);
}

export function PwaPullToRefresh({ active = true }: { active?: boolean }) {
  const [state, setState] = useState<PullState>("idle");
  const bannerRef = useRef<HTMLDivElement | null>(null);
  const iosStandalone = useMemo(() => isIosStandalone(), []);
  const enabled = active && iosStandalone;

  useEffect(() => {
    if (!enabled) return;
    applyPullStyle(bannerRef.current, 0);
    return attachPwaPullToRefresh({
      doc: document,
      win: window,
      nav: navigator,
      onStateChange: setState,
      onDistanceChange: (distance) => applyPullStyle(bannerRef.current, distance),
      onReload: () => window.location.reload(),
    });
  }, [enabled]);

  if (!enabled) return null;
  const label =
    state === "ready"
      ? "松开刷新"
      : state === "refreshing"
        ? "正在刷新"
        : state === "offline"
          ? "网络不可用"
          : "下拉刷新";

  return (
    <div
      ref={bannerRef}
      className="pwa-pull-refresh"
      data-state={state}
      aria-live="polite"
      aria-hidden={state === "idle"}
    >
      <RotateCw size={15} strokeWidth={2.2} aria-hidden />
      <span>{label}</span>
    </div>
  );
}
