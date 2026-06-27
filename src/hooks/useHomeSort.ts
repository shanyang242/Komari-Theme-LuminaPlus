import { useCallback, useMemo, useState } from "react";
import { useThemeSettings } from "@/hooks/useThemeSettings";
import {
  HOME_SORT_NATURAL_DIRECTION,
  isHomeSortDirection,
  isHomeSortField,
  type HomeSortDirection,
  type HomeSortField,
} from "@/utils/homeSort";

// 访客首页排序偏好。仿 useViewMode:管理员设站点默认(themeSettings),访客的临时选择写
// sessionStorage 覆盖;选回与默认一致即清除覆盖(将来站长改默认仍能生效)。单一消费者(NodeGrid)
// 持有,再把状态下发给排序控件,避免多实例各存一份而分叉。
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

export interface HomeSortControlState {
  field: HomeSortField;
  direction: HomeSortDirection;
  setField: (field: HomeSortField) => void;
  toggleDirection: () => void;
}

export function useHomeSort(): HomeSortControlState {
  const themeSettings = useThemeSettings();
  const defaultField = themeSettings.homeSortField;
  const defaultDir = themeSettings.homeSortDirection;
  const [override, setOverride] = useState<SortPref | null>(() => readOverride());

  const field = override?.field ?? defaultField;
  const direction = override?.dir ?? defaultDir;

  const apply = useCallback(
    (next: SortPref) => {
      if (next.field === defaultField && next.dir === defaultDir) {
        clearOverride();
        setOverride(null);
      } else {
        writeOverride(next);
        setOverride(next);
      }
    },
    [defaultField, defaultDir],
  );

  const setField = useCallback(
    (nextField: HomeSortField) => {
      // 切到新维度时用该维度的自然方向(文本升、数值降)。
      apply({ field: nextField, dir: HOME_SORT_NATURAL_DIRECTION[nextField] });
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
