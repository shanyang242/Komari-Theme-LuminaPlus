import { describe, expect, it } from "vitest";
import type uPlot from "uplot";
import {
  buildPingSeriesOverlay,
  drawPingOverlay,
  type PingSeriesOverlay,
} from "@/components/instance/pingChartOverlay";

interface CanvasCall {
  method: string;
  args: unknown[];
}

interface TrackedCanvasState {
  globalAlpha: number;
  lineWidth: number;
  strokeStyle: string;
  fillStyle: string;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
}

const INITIAL_CANVAS_STATE: TrackedCanvasState = {
  globalAlpha: 1,
  lineWidth: 1,
  strokeStyle: "",
  fillStyle: "",
  font: "",
  textAlign: "start",
  textBaseline: "alphabetic",
};

// save/restore 必须真的还原绘制状态，否则「透明度有没有泄漏」这类断言测的是 double 自己。
function fakeContext() {
  const calls: CanvasCall[] = [];
  const stack: TrackedCanvasState[] = [];
  const record =
    (method: string) =>
    (...args: unknown[]) => {
      calls.push({ method, args });
    };
  const ctx = {
    ...INITIAL_CANVAS_STATE,
    calls,
    save() {
      calls.push({ method: "save", args: [] });
      stack.push({
        globalAlpha: ctx.globalAlpha,
        lineWidth: ctx.lineWidth,
        strokeStyle: ctx.strokeStyle,
        fillStyle: ctx.fillStyle,
        font: ctx.font,
        textAlign: ctx.textAlign,
        textBaseline: ctx.textBaseline,
      });
    },
    restore() {
      calls.push({ method: "restore", args: [] });
      const snapshot = stack.pop();
      if (snapshot) Object.assign(ctx, snapshot);
    },
    beginPath: record("beginPath"),
    closePath: record("closePath"),
    rect: record("rect"),
    clip: record("clip"),
    moveTo: record("moveTo"),
    lineTo: record("lineTo"),
    arc: record("arc"),
    stroke: record("stroke"),
    fill: record("fill"),
    fillText: record("fillText"),
  };
  return ctx;
}

// x 直接当像素用；y 翻转成「值越大越靠上」，与真实图表一致。
function fakePlot(times: number[], ctx: ReturnType<typeof fakeContext>) {
  return {
    ctx,
    data: [times] as unknown as uPlot.AlignedData,
    bbox: { left: 0, top: 0, width: 400, height: 200 },
    over: { clientWidth: 400 },
    valToPos: (value: number, scaleKey: string) =>
      scaleKey === "x" ? value : 200 - value,
  } as unknown as uPlot;
}

function callsOf(ctx: ReturnType<typeof fakeContext>, method: string) {
  return ctx.calls.filter((call) => call.method === method);
}

describe("drawPingOverlay", () => {
  const times = [0, 10, 20, 30];

  it("为每个丢包点画一条竖线", () => {
    const ctx = fakeContext();
    const overlay = buildPingSeriesOverlay([5, null, 8, null], "#f00");

    drawPingOverlay(fakePlot(times, ctx), [overlay], {
      showLossLines: true,
      showExtremePins: false,
    });

    const moves = callsOf(ctx, "moveTo");
    expect(moves).toHaveLength(2);
    expect(moves.map((call) => call.args[0])).toEqual([10.5, 30.5]);
    expect(callsOf(ctx, "fillText")).toHaveLength(0);
  });

  it("为极值画出带取整数值的 pin", () => {
    const ctx = fakeContext();
    const overlay = buildPingSeriesOverlay([5.4, 120.6, 60, 30], "#f00");

    drawPingOverlay(fakePlot(times, ctx), [overlay], {
      showLossLines: false,
      showExtremePins: true,
    });

    expect(callsOf(ctx, "fillText").map((call) => call.args[0])).toEqual(["121", "5"]);
    expect(callsOf(ctx, "arc")).toHaveLength(2);
  });

  it("两项都关闭时不碰画布", () => {
    const ctx = fakeContext();
    const overlay = buildPingSeriesOverlay([5, null], "#f00");

    drawPingOverlay(fakePlot(times, ctx), [overlay], {
      showLossLines: false,
      showExtremePins: false,
    });

    expect(ctx.calls).toHaveLength(0);
  });

  it("没有可见线路时不碰画布", () => {
    const ctx = fakeContext();

    drawPingOverlay(fakePlot(times, ctx), [] as PingSeriesOverlay[], {
      showLossLines: true,
      showExtremePins: true,
    });

    expect(ctx.calls).toHaveLength(0);
  });

  it("save/restore 成对出现，不把裁剪或透明度泄漏给后续绘制", () => {
    const ctx = fakeContext();
    const overlay = buildPingSeriesOverlay([5, null, 90], "#f00");

    drawPingOverlay(fakePlot(times, ctx), [overlay], {
      showLossLines: true,
      showExtremePins: true,
    });

    expect(callsOf(ctx, "save")).toHaveLength(callsOf(ctx, "restore").length);
    expect(callsOf(ctx, "clip")).toHaveLength(1);
    expect(ctx.globalAlpha).toBe(1);
  });
});
