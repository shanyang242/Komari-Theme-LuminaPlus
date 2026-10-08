import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

const HOLD_DELAY_MS = 300;
const MOVE_TOLERANCE_PX = 8;
const EDGE_SCROLL_PX = 32;

interface SortableFilterRowProps {
  items: string[];
  selected: string;
  className: string;
  itemClassName?: string;
  label: string;
  canReorder: boolean;
  onSelect: (item: string) => void;
  onReorder: (order: string[]) => void;
  renderItem: (item: string) => ReactNode;
  leadingContent?: ReactNode;
}

interface DragSession {
  id: string;
  pointerId: number;
  sourceKey: string;
  initialOrder: string[];
  order: string[];
  startX: number;
  startY: number;
  x: number;
  y: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
  active: boolean;
  timer?: number;
  frame?: number;
}

type DragPreview = Pick<
  DragSession,
  "id" | "sourceKey" | "order" | "x" | "y" | "offsetX" | "offsetY" | "width" | "height"
>;

function insideRow(row: HTMLElement, x: number, y: number) {
  const rect = row.getBoundingClientRect();
  return x >= rect.left - 24 && x <= rect.right + 24 &&
    y >= rect.top - 24 && y <= rect.bottom + 24;
}

/** 鼠标长按排序；短按和触摸滚动继续使用原有筛选行为。 */
export function SortableFilterRow({
  items, selected, className, itemClassName, label, canReorder,
  onSelect, onReorder, renderItem, leadingContent,
}: SortableFilterRowProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<DragSession | null>(null);
  const suppressClickRef = useRef(false);
  const onReorderRef = useRef(onReorder);
  const positionsRef = useRef<Map<string, DOMRect> | null>(null);
  const [drag, setDrag] = useState<DragPreview | null>(null);
  const sourceKey = JSON.stringify(items);
  const hintId = useId();
  const previewOrder = drag?.sourceKey === sourceKey ? drag.order : items;
  const enabled = canReorder && items.length > 1;

  useEffect(() => { onReorderRef.current = onReorder; }, [onReorder]);

  const finish = useCallback((commit: boolean) => {
    const session = sessionRef.current;
    if (!session) return;
    sessionRef.current = null;
    window.clearTimeout(session.timer);
    if (session.frame !== undefined) window.cancelAnimationFrame(session.frame);
    if (session.active) {
      document.documentElement.classList.remove("home-filter-sorting");
      const row = rowRef.current;
      if (row?.hasPointerCapture(session.pointerId)) row.releasePointerCapture(session.pointerId);
    }
    positionsRef.current = null;
    setDrag(null);
    if (commit && session.active &&
      session.order.some((item, index) => item !== session.initialOrder[index])) {
      onReorderRef.current(session.order);
    }
  }, []);

  const updatePreview = useCallback((session: DragSession, scroll = true) => {
    const row = rowRef.current;
    if (!row) return;
    if (insideRow(row, session.x, session.y)) {
      const rect = row.getBoundingClientRect();
      if (scroll && row.scrollWidth > row.clientWidth) {
        const left = Math.max(0, EDGE_SCROLL_PX - (session.x - rect.left));
        const right = Math.max(0, EDGE_SCROLL_PX - (rect.right - session.x));
        row.scrollLeft += Math.max(-12, Math.min(12, (right - left) * 0.4));
      }
      const buttons = Array.from(row.querySelectorAll<HTMLButtonElement>("[data-sort-item]"));
      const targetIndex = buttons.filter((button) => {
        const bounds = button.getBoundingClientRect();
        return button.dataset.sortItem !== session.id && session.x > bounds.left + bounds.width / 2;
      }).length;
      const currentIndex = session.order.indexOf(session.id);
      if (targetIndex !== currentIndex) {
        positionsRef.current = new Map(buttons.map((button) =>
          [button.dataset.sortItem!, button.getBoundingClientRect()],
        ));
        const next = [...session.order];
        next.splice(currentIndex, 1);
        next.splice(targetIndex, 0, session.id);
        session.order = next;
      }
    }
    setDrag((previous) => previous?.order === session.order &&
      previous.x === session.x && previous.y === session.y
      ? previous
      : {
          id: session.id, sourceKey: session.sourceKey, order: session.order,
          x: session.x, y: session.y, offsetX: session.offsetX, offsetY: session.offsetY,
          width: session.width, height: session.height,
        },
    );
  }, []);

  useLayoutEffect(() => {
    const before = positionsRef.current;
    positionsRef.current = null;
    if (!before || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    rowRef.current?.querySelectorAll<HTMLButtonElement>("[data-sort-item]").forEach((button) => {
      const previous = before.get(button.dataset.sortItem!);
      if (!previous || button.dataset.sortItem === sessionRef.current?.id) return;
      const dx = previous.left - button.getBoundingClientRect().left;
      if (dx) button.animate([{ transform: `translateX(${dx}px)` }, { transform: "translateX(0)" }], {
        duration: 140, easing: "ease-out",
      });
    });
  }, [previewOrder]);

  // 权限、分组或节点选项变化时取消手势，防止把旧列表写回新上下文。
  useLayoutEffect(() => {
    if (!enabled || sessionRef.current?.sourceKey !== sourceKey) finish(false);
  }, [enabled, sourceKey, finish]);

  useEffect(() => {
    const onMove = (event: globalThis.PointerEvent) => {
      const session = sessionRef.current;
      if (!session || session.pointerId !== event.pointerId) return;
      if (!(event.buttons & 1)) { finish(false); return; }
      session.x = event.clientX;
      session.y = event.clientY;
      if (session.active) event.preventDefault();
      else if (Math.hypot(session.x - session.startX, session.y - session.startY) > MOVE_TOLERANCE_PX) {
        suppressClickRef.current = true;
        finish(false);
      }
    };
    const onUp = (event: globalThis.PointerEvent) => {
      const session = sessionRef.current;
      if (!session || session.pointerId !== event.pointerId) return;
      session.x = event.clientX;
      session.y = event.clientY;
      if (session.active) updatePreview(session, false);
      finish(!!rowRef.current && insideRow(rowRef.current, session.x, session.y));
    };
    const onCancel = (event: globalThis.PointerEvent) => {
      if (sessionRef.current?.pointerId === event.pointerId) finish(false);
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && sessionRef.current) {
        event.preventDefault();
        finish(false);
      }
    };
    const onBlur = () => finish(false);
    const onVisibilityChange = () => {
      if (document.hidden) finish(false);
    };
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      finish(false);
    };
  }, [finish, updatePreview]);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !event.isPrimary) return;
    suppressClickRef.current = false;
    if (!enabled || event.pointerType !== "mouse") return;
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-sort-item]");
    const id = button?.dataset.sortItem;
    if (!button || id === undefined || !items.includes(id)) return;
    finish(false);
    const rect = button.getBoundingClientRect();
    const session: DragSession = {
      id, pointerId: event.pointerId, sourceKey, initialOrder: items, order: items,
      startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY,
      offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top,
      width: rect.width, height: rect.height, active: false,
    };
    sessionRef.current = session;
    session.timer = window.setTimeout(() => {
      if (sessionRef.current !== session) return;
      session.active = true;
      suppressClickRef.current = true;
      document.documentElement.classList.add("home-filter-sorting");
      rowRef.current?.setPointerCapture(session.pointerId);
      const tick = () => {
        if (sessionRef.current !== session) return;
        updatePreview(session);
        session.frame = window.requestAnimationFrame(tick);
      };
      tick();
    }, HOLD_DELAY_MS);
  };

  const onClickCapture = (event: MouseEvent<HTMLDivElement>) => {
    if (!suppressClickRef.current || event.detail === 0) return;
    suppressClickRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!enabled || !event.altKey || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-sort-item]");
    const index = items.indexOf(button?.dataset.sortItem ?? "");
    if (index < 0) return;
    event.preventDefault();
    if (sessionRef.current) return;
    const target = index + (event.key === "ArrowLeft" ? -1 : 1);
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    onReorder(next);
  };

  return (
    <>
      <div
        ref={rowRef} className={className} role="group" aria-label={label}
        aria-describedby={enabled ? hintId : undefined}
        data-reorderable={enabled ? "true" : undefined}
        onPointerDown={onPointerDown} onClickCapture={onClickCapture} onKeyDown={onKeyDown}
        onLostPointerCapture={() => finish(false)} onDragStart={(event) => event.preventDefault()}
      >
        {leadingContent}
        {previewOrder.map((item) => (
          <button
            key={item} type="button" className={itemClassName} data-sort-item={item}
            data-sort-dragging={drag?.id === item ? "true" : undefined}
            data-active={selected === item ? "true" : "false"} aria-pressed={selected === item}
            title={enabled ? `${item} · 长按拖动排序` : item}
            onClick={() => onSelect(item)}
          >
            {renderItem(item)}
          </button>
        ))}
      </div>
      {enabled && <span id={hintId} className="sr-only">长按拖动排序，也可按 Alt 加左右方向键调整。按 Esc 取消拖动。</span>}
      {drag && createPortal(
        <div
          className="home-filter-drag-preview" aria-hidden
          style={{ left: drag.x - drag.offsetX, top: drag.y - drag.offsetY, width: drag.width, height: drag.height }}
        >
          {renderItem(drag.id)}
        </div>,
        document.body,
      )}
    </>
  );
}
