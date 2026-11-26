import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useThemeSettings } from "@/hooks/useThemeSettings";
import {
  HOME_SORT_NATURAL_DIRECTION,
  isHomeSortDirection,
  isHomeSortField,
  type HomeSortDirection,
  type HomeSortField,
} from "@/utils/homeSort";

// 访客首页排序偏好。管理员设站点默认(themeSettings),访客的临时选择写 sessionStorage 覆盖;
// 选回与默认一致即清除覆盖(将来站长改默认仍能生效)。NodeGrid 与右上角悬浮控件会分别
// 调用这个 hook，因此用模块级 external store 保证两处始终读取同一份即时状态。
const OVERRIDE_KEY = "komaritheme:home-sort";

interface SortPref {
  field: HomeSortField;
  dir: HomeSortDirection;
}

function readOverride(): SortPref | null {
  try {
    const raw = sessionStorage.getItem(OVERRIDE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SortPref> | null;
    if (isHomeSortField(parsed?.field) && isHomeSortDirection(parsed?.dir)) {
      return { field: parsed.field, dir: parsed.dir };
    }
  } catch {
    // sessionStorage 不可用或脏数据:按无覆盖处理。
  }
  return null;
}

function writeOverride(pref: SortPref) {
  try {
    sessionStorage.setItem(OVERRIDE_KEY, JSON.stringify(pref));
  } catch {
    // 存不进就只保留内存态。
  }
}

function clearOverride() {
  try {
    sessionStorage.removeItem(OVERRIDE_KEY);
  } catch {
    // 没什么可清的。
  }
}

const listeners = new Set<() => void>();
let overrideSnapshot: SortPref | null = null;
let snapshotInitialized = false;

function samePref(left: SortPref | null, right: SortPref | null) {
  return left?.field === right?.field && left?.dir === right?.dir;
}

function refreshSnapshot() {
  const next = readOverride();
  if (!samePref(overrideSnapshot, next)) overrideSnapshot = next;
  return overrideSnapshot;
}

function getSnapshot() {
  if (!snapshotInitialized) {
    snapshotInitialized = true;
    refreshSnapshot();
  }
  return overrideSnapshot;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emitChange(next: SortPref | null) {
  overrideSnapshot = next;
  snapshotInitialized = true;
  listeners.forEach((listener) => listener());
}

export interface HomeSortControlState {
  field: HomeSortField;
  direction: HomeSortDirection;
  setField: (field: HomeSortField, direction?: HomeSortDirection) => void;
  toggleDirection: () => void;
}

export function useHomeSort(): HomeSortControlState {
  const themeSettings = useThemeSettings();
  const defaultField = themeSettings.homeSortField;
  const defaultDir = themeSettings.homeSortDirection;
  const override = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const field = override?.field ?? defaultField;
  const direction = override?.dir ?? defaultDir;

  const apply = useCallback(
    (next: SortPref) => {
      if (next.field === defaultField && next.dir === defaultDir) {
        clearOverride();
        emitChange(null);
      } else {
        writeOverride(next);
        emitChange(next);
      }
    },
    [defaultField, defaultDir],
  );

  const setField = useCallback(
    (nextField: HomeSortField, nextDirection?: HomeSortDirection) => {
      // 切到新维度时默认用该维度的自然方向(文本升、数值降)，允许显式指定方向。
      apply({
        field: nextField,
        dir: nextDirection ?? HOME_SORT_NATURAL_DIRECTION[nextField],
      });
    },
    [apply],
  );

  const toggleDirection = useCallback(() => {
    apply({ field, dir: direction === "asc" ? "desc" : "asc" });
  }, [apply, field, direction]);

  return useMemo(
    () => ({ field, direction, setField, toggleDirection }),
    [field, direction, setField, toggleDirection],
  );
}
