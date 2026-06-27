import { useEffect, useRef, useState } from "react";
import { ArrowDownWideNarrow, ArrowUpNarrowWide } from "lucide-react";
import {
  HOME_SORT_FIELDS,
  HOME_SORT_FIELD_LABELS,
  type HomeSortDirection,
  type HomeSortField,
} from "@/utils/homeSort";
import type { HomeSortControlState } from "@/hooks/useHomeSort";

// 一个随方向变化的「排序」图标:升序=由小到大、降序=由大到小。一个图标同时表达排序与方向,
// 不再额外堆箭头。
function SortIcon({ direction, size = 14 }: { direction: HomeSortDirection; size?: number }) {
  return direction === "asc" ? (
    <ArrowUpNarrowWide size={size} aria-hidden />
  ) : (
    <ArrowDownWideNarrow size={size} aria-hidden />
  );
}

// 首页排序控件:触发钮(排序图标 + 当前维度)→ 点开弹层单选维度。点选中维度=翻转方向(图标随之
// 变),点别的维度=切过去(用该维度自然方向)。单钮弹层,桌面/移动一致。
export function HomeSortControl({ state }: { state: HomeSortControlState }) {
  const { field, direction, setField, toggleDirection } = state;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const select = (next: HomeSortField) => {
    if (next === field) toggleDirection();
    else setField(next);
  };

  return (
    <div className="home-sort" ref={rootRef}>
      <button
        type="button"
        className="home-sort-trigger"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label="排序方式"
        title="排序方式"
        onClick={() => setOpen((value) => !value)}
      >
        <SortIcon direction={direction} />
        <span className="home-sort-trigger-label">{HOME_SORT_FIELD_LABELS[field]}</span>
      </button>
      {open && (
        // 普通 popover:一组原生按钮,Tab 移焦、Enter/Space 触发、Esc 关闭、点外部关闭。
        // 不标 listbox(那需要 roving focus + 方向键),用 aria-current 标当前排序即可。
        <div className="home-sort-panel" role="group" aria-label="排序方式">
          {HOME_SORT_FIELDS.map((option) => {
            const active = option === field;
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
                {active && <SortIcon direction={direction} size={15} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
