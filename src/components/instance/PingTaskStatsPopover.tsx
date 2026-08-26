import { createPortal } from "react-dom";
import { Info } from "lucide-react";
import { useAnchoredPopover } from "@/hooks/useAnchoredPopover";
import { useFineHover } from "@/hooks/useMediaQuery";
import { lossHeatColor } from "@/utils/metricTone";

const POPOVER_WIDTH = 208;

export interface PingTaskStatSummary {
  name: string;
  type: string;
  target: string;
  interval: number;
  latest: number | null;
  avg: number | null;
  min: number | null;
  max: number | null;
  p50: number | null;
  p99: number | null;
  volatility: number | null;
  total: number;
  lost: number;
  loss: number;
}

function formatMs(value: number | null) {
  return value == null ? "—" : `${value.toFixed(1)} ms`;
}

/**
 * 图例上的线路统计浮层。这些数字原先塞在原生 title 里，要停住鼠标等一秒才弹、
 * 触屏上完全看不到；改成受控浮层后悬停即出、点按可钉住。
 */
export function PingTaskStatsPopover({ stat }: { stat: PingTaskStatSummary }) {
  const fineHover = useFineHover();
  const { open, position, triggerRef, surfaceRef, openOnHover, scheduleClose, togglePinned } =
    useAnchoredPopover<HTMLButtonElement, HTMLDivElement>({
      fallbackWidth: POPOVER_WIDTH,
    });

  const rows: Array<[string, string, string?]> = [
    ["当前", formatMs(stat.latest)],
    ["均值", formatMs(stat.avg)],
    ["最低", formatMs(stat.min)],
    ["最高", formatMs(stat.max)],
    ["P50", formatMs(stat.p50)],
    ["P99", formatMs(stat.p99)],
    ["抖动", stat.volatility == null ? "—" : stat.volatility.toFixed(2)],
    ["丢包", `${stat.loss.toFixed(1)}%`, lossHeatColor(stat.loss)],
    ["样本", `${stat.lost} / ${stat.total}`],
  ];

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="instance-ping-task-info"
        aria-label={`${stat.name} 线路统计`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={togglePinned}
        onPointerEnter={fineHover ? openOnHover : undefined}
        onPointerLeave={fineHover ? scheduleClose : undefined}
      >
        <Info size={12} strokeWidth={2.2} aria-hidden />
      </button>
      {open &&
        createPortal(
          <div
            ref={surfaceRef}
            className="instance-ping-stats-popover"
            role="dialog"
            aria-label={`${stat.name} 线路统计`}
            style={
              position
                ? { top: position.top, left: position.left }
                : { top: 0, left: 0, visibility: "hidden" }
            }
            onPointerEnter={fineHover ? openOnHover : undefined}
            onPointerLeave={fineHover ? scheduleClose : undefined}
          >
            <div className="instance-ping-stats-head">
              <span className="instance-ping-stats-name">{stat.name}</span>
              <span className="instance-ping-stats-meta">
                {stat.type.toUpperCase()} · {stat.interval}s
              </span>
            </div>
            {stat.target && (
              <div className="instance-ping-stats-target" title={stat.target}>
                {stat.target}
              </div>
            )}
            <dl className="instance-ping-stats-rows">
              {rows.map(([label, value, color]) => (
                <div key={label} className="instance-ping-stats-row">
                  <dt>{label}</dt>
                  <dd className="tabular" style={color ? { color } : undefined}>
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          </div>,
          document.body,
        )}
    </>
  );
}
