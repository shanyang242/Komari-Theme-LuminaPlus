import { describe, expect, it, vi } from "vitest";
import type uPlot from "uplot";
import {
  buildChartCursor,
  buildChartXScale,
  buildLoadTimeRangeOptions,
  buildPingTimeRangeOptions,
} from "@/components/instance/chartShared";

describe("detail chart time ranges", () => {
  it("keeps Ping limited to 1h, 4h, 1d and 7d even with 90 days retained", () => {
    expect(buildPingTimeRangeOptions(90 * 24)).toEqual([
      { label: "1 小时", value: 1 },
      { label: "4 小时", value: 4 },
      { label: "1 天", value: 24 },
      { label: "7 天", value: 168 },
    ]);
  });

  it("keeps at least the 1h Ping option when retention is positive but below 1 hour", () => {
    expect(buildPingTimeRangeOptions(0.5)).toEqual([{ label: "1 小时", value: 1 }]);
    expect(buildPingTimeRangeOptions(0)).toEqual([
      { label: "1 小时", value: 1 },
      { label: "4 小时", value: 4 },
      { label: "1 天", value: 24 },
      { label: "7 天", value: 168 },
    ]);
  });

  it("keeps load history capped at 30 days even with 90 days retained", () => {
    expect(buildLoadTimeRangeOptions(90 * 24)).toEqual([
      { label: "实时", value: 0 },
      { label: "1 小时", value: 1 },
      { label: "4 小时", value: 4 },
      { label: "1 天", value: 24 },
      { label: "7 天", value: 168 },
      { label: "30 天", value: 720 },
    ]);
  });
});

describe("chart x-scale zoom and reset helpers", () => {
  it("sets fixed x bounds via min/max instead of a constant range() callback so drag zoom persists", () => {
    const fixed = buildChartXScale([1000, 5000]);
    expect(fixed).toEqual({ time: true, auto: false, min: 1000, max: 5000 });
    expect("range" in fixed).toBe(false);
    expect(buildChartXScale(null)).toEqual({ time: true });
  });

  it("resets zoomed x scale back to requested xRange on primary double click without redundant autoScaleX", () => {
    const setScale = vi.fn();
    const defaultHandler = vi.fn(() => null);
    let currentRange: [number, number] | null = [1000, 5000];
    const targ = {} as HTMLElement;
    const fakePlot = {
      cursor: { _lock: false },
      setScale,
    } as unknown as uPlot;

    const cursor = buildChartCursor(() => currentRange);
    expect(cursor.drag).toEqual({ x: true, y: false });
    const listener = cursor.bind?.dblclick?.(fakePlot, targ, defaultHandler);
    expect(listener).toBeTypeOf("function");

    // 非主键或非目标元素双击忽略
    listener!({ button: 2, target: targ } as unknown as MouseEvent);
    listener!({ button: 0, target: {} } as unknown as MouseEvent);
    expect(setScale).not.toHaveBeenCalled();
    expect(defaultHandler).not.toHaveBeenCalled();

    // 固定 xRange 时直接复位到 requested xRange，不重复调用 uPlot 内置 autoScaleX handler
    listener!({ button: 0, target: targ } as unknown as MouseEvent);
    expect(setScale).toHaveBeenCalledTimes(1);
    expect(setScale).toHaveBeenCalledWith("x", { min: 1000, max: 5000 });
    expect(defaultHandler).not.toHaveBeenCalled();

    // cursor 锁定时不复位
    (fakePlot.cursor as uPlot.Cursor & { _lock?: boolean })._lock = true;
    setScale.mockClear();
    listener!({ button: 0, target: targ } as unknown as MouseEvent);
    expect(setScale).not.toHaveBeenCalled();
    expect(defaultHandler).not.toHaveBeenCalled();

    // 无固定 xRange（如实时图或旧后端）时委派给 uPlot 默认双击行为
    (fakePlot.cursor as uPlot.Cursor & { _lock?: boolean })._lock = false;
    currentRange = null;
    listener!({ button: 0, target: targ } as unknown as MouseEvent);
    expect(setScale).not.toHaveBeenCalled();
    expect(defaultHandler).toHaveBeenCalledTimes(1);
  });
});
