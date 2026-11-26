import { useEffect, useId, useRef, useState } from "react";
import { ArrowDownWideNarrow, ArrowUpNarrowWide } from "lucide-react";
import {
  HOME_SORT_FIELDS,
  HOME_SORT_FIELD_LABELS,
  HOME_SORT_NATURAL_DIRECTION,
  type HomeSortDirection,
  type HomeSortField,
} from "@/utils/homeSort";
import type { HomeSortControlState } from "@/hooks/useHomeSort";

// 单个图标同时表达排序与方向。
function SortIcon({ direction, size = 14 }: { direction: HomeSortDirection; size?: number }) {
  return direction === "asc" ? (
    <ArrowUpNarrowWide size={size} aria-hidden />
  ) : (
    <ArrowDownWideNarrow size={size} aria-hidden />
  );
}

// 选择当前维度会翻转方向，选择其他维度会采用该维度的自然方向。
export function HomeSortControl({
  state,
  showPrice = true,
}: {
  state: HomeSortControlState;
  showPrice?: boolean;
}) {
  const { field, direction, setField, toggleDirection } = state;
  const visibleField = !showPrice && field === "price" ? "default" : field;
  const visibleDirection = !showPrice && field === "price"
    ? HOME_SORT_NATURAL_DIRECTION.default
    : direction;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const select = (next: HomeSortField) => {
    if (next === visibleField) {
      if (next === field) {
        toggleDirection();
      } else {
        setField(next, visibleDirection === "asc" ? "desc" : "asc");
      }
    } else {
      setField(next);
    }
  };

  return (
    <div className="home-sort" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="home-sort-trigger"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={`排序方式，当前${HOME_SORT_FIELD_LABELS[visibleField]}${visibleDirection === "asc" ? "升序" : "降序"}`}
        title={`排序：${HOME_SORT_FIELD_LABELS[visibleField]}（${visibleDirection === "asc" ? "升序" : "降序"}）`}
        onClick={() => setOpen((value) => !value)}
      >
        <SortIcon direction={visibleDirection} />
        <span>{HOME_SORT_FIELD_LABELS[visibleField]}</span>
      </button>
      {open && (
        <div id={panelId} className="home-sort-panel" role="group" aria-label="排序方式">
          {HOME_SORT_FIELDS.map((option) => {
            if (!showPrice && option === "price") return null;
            const active = option === visibleField;
            return (
              <button
                key={option}
                type="button"
                aria-current={active ? "true" : undefined}
                data-active={active ? "true" : "false"}
                className="home-sort-item"
                onClick={() => select(option)}
              >
                <span className="home-sort-item-label">{HOME_SORT_FIELD_LABELS[option]}</span>
                {active && <SortIcon direction={visibleDirection} size={15} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
