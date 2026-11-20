import { useCallback, useMemo } from "react";
import {
  Cpu,
  MemoryStick,
  HardDrive,
  Gauge,
  Database,
  Zap,
  ArrowUp,
  ArrowDown,
  RotateCcw,
} from "lucide-react";
import { usePreferences } from "@/hooks/usePreferences";
import {
  DEFAULT_DARK_DEPTH,
  METRIC_COLOR_GROUPS,
  METRIC_COLOR_META,
  getDefaultMetricColors,
  useMetricColorsEditor,
  type MetricColorKey,
} from "@/hooks/useMetricColors";

const DARK_DEPTH_PRESETS = [
  { value: 0, label: "灰黑", title: "当前默认色" },
  { value: 60, label: "深黑", title: "保留少量蓝灰层次" },
  { value: 100, label: "纯黑", title: "纯黑画布，卡片保留层级" },
] as const;

const ICONS: Record<MetricColorKey, typeof Cpu> = {
  cpu: Cpu,
  memory: MemoryStick,
  disk: HardDrive,
  load: Gauge,
  swap: Database,
  speedIdle: Zap,
  speedLow: Zap,
  speedHigh: Zap,
  speedMax: Zap,
  trafficUp: ArrowUp,
  trafficDown: ArrowDown,
};

export function MetricColorPicker({ hidden = false }: { hidden?: boolean }) {
  const {
    colors,
    darkDepth,
    setColor,
    resetColor,
    setDarkDepth,
    resetAll,
    saveError,
  } = useMetricColorsEditor();
  const { resolvedAppearance } = usePreferences();
  const base = useMemo(
    () => getDefaultMetricColors(resolvedAppearance),
    [resolvedAppearance],
  );

  const valueOf = useCallback(
    (key: MetricColorKey) => colors[key] ?? base[key],
    [colors, base],
  );
  const hasAny = Object.keys(colors).length > 0 || darkDepth !== DEFAULT_DARK_DEPTH;

  return (
    <div
      className="metric-color-picker"
      role="group"
      aria-label="卡片配色"
      hidden={hidden}
    >
      <div className="metric-color-picker-head">
        <span>配色自定义</span>
        <button
          type="button"
          className="metric-color-reset-all"
          onClick={resetAll}
          disabled={!hasAny}
        >
          全部重置
        </button>
      </div>
      {saveError && <div className="metric-color-error">保存失败（请确认已登录管理员）</div>}
      <div className="metric-color-group">
        <div className="metric-color-group-title">暗色背景</div>
        <div className="dark-depth-control">
          <div className="dark-depth-presets" role="group" aria-label="暗色深度预设">
            {DARK_DEPTH_PRESETS.map((preset) => (
              <button
                key={preset.value}
                type="button"
                className="dark-depth-preset"
                data-active={darkDepth === preset.value ? "true" : "false"}
                data-depth={preset.value}
                aria-pressed={darkDepth === preset.value}
                title={preset.title}
                onClick={() => setDarkDepth(preset.value)}
              >
                <span className="dark-depth-preset-swatch" aria-hidden />
                <span>{preset.label}</span>
              </button>
            ))}
          </div>
          <label className="dark-depth-range">
            <span className="dark-depth-range-head">
              <span>黑色程度</span>
              <output>{darkDepth}%</output>
            </span>
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              value={darkDepth}
              aria-label="黑色程度"
              onChange={(event) => setDarkDepth(Number(event.target.value))}
            />
          </label>
          {resolvedAppearance !== "dark" && (
            <p className="dark-depth-hint">切换到深色模式后查看实际效果</p>
          )}
        </div>
      </div>
      {METRIC_COLOR_GROUPS.map((group) => (
        <div className="metric-color-group" key={group.id}>
          <div className="metric-color-group-title">{group.label}</div>
          <div className="metric-color-list">
            {METRIC_COLOR_META.filter((item) => item.group === group.id).map(({ key, label }) => {
              const Icon = ICONS[key];
              const overridden = colors[key] != null;
              return (
                <div className="metric-color-row" key={key}>
                  <Icon size={14} className="metric-color-icon" />
                  <span className="metric-color-name">{label}</span>
                  <label className="metric-color-swatch" style={{ background: valueOf(key) }}>
                    <input
                      type="color"
                      value={valueOf(key)}
                      onChange={(event) => setColor(key, event.target.value)}
                      aria-label={`${label} 颜色`}
                    />
                  </label>
                  <button
                    type="button"
                    className="metric-color-reset"
                    onClick={() => resetColor(key)}
                    disabled={!overridden}
                    aria-label={`恢复 ${label} 默认色`}
                    title="恢复默认"
                  >
                    <RotateCcw size={13} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
