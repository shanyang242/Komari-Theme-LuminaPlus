import type { ChartTooltipState } from "./chartShared";

// LoadChart 与 PingChart 共享的悬停 tooltip。两者此前各持一份逐字节相同的 JSX。
export function ChartTooltip({ tooltip }: { tooltip: ChartTooltipState }) {
  if (!tooltip.show) return null;
  return (
    <div className="instance-chart-tooltip" style={{ left: tooltip.left, top: tooltip.top }}>
      <div className="instance-chart-tooltip-time">{tooltip.time}</div>
      {tooltip.rows.map((row) => (
        <div key={`${row.label}-${row.color}`} className="instance-chart-tooltip-row">
          <span className="instance-chart-tooltip-dot" style={{ background: row.color }} />
          <span>{row.label}</span>
          <strong>{row.value}</strong>
        </div>
      ))}
    </div>
  );
}

// 图表工具条里的开关按钮（断点连线 / 削峰平滑）。开/关文案、提示与按下态在此统一。
export function SwitchToggle({
  label,
  active,
  onToggle,
  title,
}: {
  label: string;
  active: boolean;
  onToggle: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      className="instance-toggle-button instance-switch-button"
      data-active={active ? "true" : "false"}
      onClick={onToggle}
      aria-pressed={active}
      title={title}
    >
      <span className="instance-switch-copy">{label}</span>
      <span className="instance-switch-track" aria-hidden>
        <span className="instance-switch-thumb" />
      </span>
      <span className="instance-switch-state">{active ? "开启" : "关闭"}</span>
    </button>
  );
}
