import { useCallback, useEffect, useState } from "react";
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
  METRIC_COLOR_GROUPS,
  METRIC_COLOR_META,
  readEffectiveColors,
  useMetricColorsEditor,
  type MetricColorKey,
} from "@/hooks/useMetricColors";

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

export function MetricColorPicker() {
  const { colors, setColor, resetColor, resetAll, saveError } = useMetricColorsEditor();
  const { resolvedAppearance } = usePreferences();

  // 默认色（无覆盖时生效的 token）。只在明暗模式切换/重置时重读 ——
  // 不能放进拖动热路径：getComputedStyle 会强制同步重排，每帧多次=掉帧。
  const [base, setBase] = useState(readEffectiveColors);
  useEffect(() => setBase(readEffectiveColors()), [resolvedAppearance]);
  const refreshBase = useCallback(() => setBase(readEffectiveColors()), []);

  // 拖动时取色框的值直接来自草稿（无 getComputedStyle），其余指标用稳定的默认色。
  const valueOf = useCallback(
    (key: MetricColorKey) => colors[key] ?? base[key],
    [colors, base],
  );
  const hasAny = Object.keys(colors).length > 0;

  return (
    <div className="metric-color-picker" role="group" aria-label="卡片配色">
      <div className="metric-color-picker-head">
        <span>配色自定义</span>
        <button
          type="button"
          className="metric-color-reset-all"
          onClick={() => {
            resetAll();
            refreshBase();
          }}
          disabled={!hasAny}
        >
          全部重置
        </button>
      </div>
      {saveError && <div className="metric-color-error">保存失败（请确认已登录管理员）</div>}
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
                    onClick={() => {
                      resetColor(key);
                      refreshBase();
                    }}
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
