import { useState } from "react";
import { AlertTriangle, ChevronLeft, ChevronRight, LayoutGrid, Monitor, Rows3, Settings, SlidersHorizontal, Sun, Moon } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { usePreferences } from "@/hooks/usePreferences";
import { useViewMode } from "@/hooks/useViewMode";
import { useNodeStoreStatus } from "@/hooks/useNode";
import { useAuth } from "@/hooks/useAuth";
import { useThemeSettings } from "@/hooks/useThemeSettings";
import { clsx } from "clsx";

const APPEARANCE_OPTIONS = [
  { value: "light", icon: Sun, label: "浅色" },
  { value: "system", icon: Monitor, label: "跟随系统" },
  { value: "dark", icon: Moon, label: "深色" },
] as const;

export function FloatingControls() {
  const { appearance, setAppearance } = usePreferences();
  const { mode, toggleMode } = useViewMode();
  const { data: me } = useAuth();
  const themeSettings = useThemeSettings();
  const { failureStreak } = useNodeStoreStatus();
  const [searchParams] = useSearchParams();
  const [collapsed, setCollapsed] = useState(true);
  const showAdmin = themeSettings.enableAdminButton;
  const showThemeManage = Boolean(me?.logged_in);
  const isThemeManageView = searchParams.get("view") === "theme-manage";
  const showSyncWarning = failureStreak >= 2;
  const hiddenTabIndex = collapsed ? -1 : undefined;
  const ToggleIcon = collapsed ? ChevronLeft : ChevronRight;
  const ViewIcon = mode === "compact" ? LayoutGrid : Rows3;

  if (isThemeManageView) {
    return null;
  }

  return (
    <div
      className={clsx(
        "floating-controls",
        collapsed && "is-collapsed",
        showSyncWarning && "has-warning",
      )}
    >
      <div className="floating-controls-inner">
        <div className="floating-controls-row">
          <div className="floating-controls-actions" aria-hidden={collapsed}>
            <div
              className="control-group"
              role="group"
              aria-label="外观选择"
            >
              {APPEARANCE_OPTIONS.map(({ value, icon: Icon, label }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setAppearance(value)}
                  aria-label={label}
                  aria-pressed={appearance === value}
                  title={label}
                  tabIndex={hiddenTabIndex}
                  className={clsx(
                    "control-button control-toggle grid h-9 w-9 place-items-center",
                    appearance === value && "is-active",
                  )}
                >
                  <Icon size={16} />
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={toggleMode}
              aria-label="紧凑视图"
              aria-pressed={mode === "compact"}
              title={mode === "compact" ? "临时切换到大视图" : "临时切换到小视图"}
              tabIndex={hiddenTabIndex}
              className={clsx(
                "control-button grid h-9 w-9 place-items-center",
                mode === "compact" && "control-toggle is-active",
              )}
            >
              <ViewIcon size={16} />
            </button>
            {showThemeManage && (
              <Link
                to="/?view=theme-manage"
                aria-label="主题设置"
                title="主题设置"
                tabIndex={hiddenTabIndex}
                className={clsx(
                  "control-button grid h-9 w-9 place-items-center",
                  isThemeManageView && "control-toggle is-active",
                )}
              >
                <SlidersHorizontal size={16} />
              </Link>
            )}
            {showAdmin && (
              <a
                href="/admin"
                aria-label={me?.logged_in ? "管理" : "后台登录"}
                title={me?.logged_in ? "管理" : "后台登录"}
                tabIndex={hiddenTabIndex}
                className="control-button grid h-9 w-9 place-items-center"
              >
                <Settings size={16} />
              </a>
            )}
          </div>
          <button
            type="button"
            className="control-button floating-controls-trigger grid h-9 w-9 place-items-center"
            aria-label={collapsed ? "展开快捷按钮" : "收起快捷按钮"}
            aria-expanded={!collapsed}
            onClick={() => setCollapsed((value) => !value)}
            title={collapsed ? "展开快捷按钮" : "收起快捷按钮"}
          >
            <ToggleIcon size={16} />
            {showSyncWarning && collapsed && (
              <span className="floating-controls-warning-dot" aria-hidden />
            )}
          </button>
        </div>
        {showSyncWarning && !collapsed && (
          <div className="pointer-events-none flex items-center gap-2 rounded-full border border-[color-mix(in_srgb,var(--status-offline)_32%,transparent)] bg-[color-mix(in_srgb,var(--surface)_90%,transparent)] px-3 py-1 text-[11px] font-medium text-[var(--status-offline)] shadow-[0_10px_25px_-18px_rgba(0,0,0,0.8)] backdrop-blur">
            <AlertTriangle size={12} />
            <span>实时状态同步异常，当前展示的是最近缓存</span>
          </div>
        )}
      </div>
    </div>
  );
}
