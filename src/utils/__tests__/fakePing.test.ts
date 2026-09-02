import { describe, expect, it } from "vitest";
import {
  buildFakeHomepagePingLine,
  buildFakePingItem,
  FAKE_PING_MAX_MS,
  FAKE_PING_MIN_MS,
} from "@/utils/fakePing";

const UUID = "3b8f0c1a-9d42-4f6e-8a17-5c2e9b04d611";
// 任意固定时刻的分钟槽,测试不依赖真实时钟。
const MINUTE_INDEX = Math.floor(1_750_000_000_000 / 60_000);

describe("buildFakePingItem", () => {
  it("同一 (uuid, 分钟槽) 生成完全一致的序列(渲染之间不闪烁)", () => {
    const first = buildFakePingItem(UUID, MINUTE_INDEX);
    const second = buildFakePingItem(UUID, MINUTE_INDEX);
    expect(second.samples).toEqual(first.samples);
    expect(second.lastValue).toBe(first.lastValue);
  });

  it("值域固定在 1-10ms,丢包恒为 0,且伪装成已绑定", () => {
    const item = buildFakePingItem(UUID, MINUTE_INDEX);
    expect(item.isAssigned).toBe(true);
    expect(item.loss).toBe(0);
    expect(item.client).toBe(UUID);
    expect(item.samples).toHaveLength(60);
    const values = item.samples.map((sample) => sample.value);
    for (const value of values) {
      expect(value).toBeGreaterThanOrEqual(FAKE_PING_MIN_MS);
      expect(value).toBeLessThanOrEqual(FAKE_PING_MAX_MS);
    }
    expect(item.lastValue).toBe(values[values.length - 1]);
    expect(item.max).toBe(Math.max(...values));
  });

  it("样本覆盖分钟槽之前的一小时窗口(usePingBuckets 才能聚合出满排柱子)", () => {
    const item = buildFakePingItem(UUID, MINUTE_INDEX);
    const now = MINUTE_INDEX * 60_000;
    for (const sample of item.samples) {
      expect(sample.time).toBeLessThanOrEqual(now);
      expect(sample.time).toBeGreaterThan(now - 60 * 60_000);
    }
  });

  it("分钟推进时序列滑动一格:旧值保留,只新增最新点", () => {
    const before = buildFakePingItem(UUID, MINUTE_INDEX);
    const after = buildFakePingItem(UUID, MINUTE_INDEX + 1);
    expect(after.samples.slice(0, -1).map((sample) => sample.value)).toEqual(
      before.samples.slice(1).map((sample) => sample.value),
    );
    expect(after.samples[0].time).toBe(before.samples[1].time);
  });

  it("不同 uuid 的曲线形态不同", () => {
    const other = buildFakePingItem("f0e1d2c3-b4a5-6789-0123-456789abcdef", MINUTE_INDEX);
    const item = buildFakePingItem(UUID, MINUTE_INDEX);
    expect(other.samples.map((sample) => sample.value)).not.toEqual(
      item.samples.map((sample) => sample.value),
    );
  });

  it("三网未绑定线路复用模拟数据并保留真实任务元数据", () => {
    const line = buildFakeHomepagePingLine(
      {
        taskId: 7,
        taskName: "联通",
        client: UUID,
        isAssigned: false,
        loadState: "ready",
        lastValue: null,
        samples: [],
        max: 1,
        loss: null,
      },
      MINUTE_INDEX,
    );

    expect(line.taskId).toBe(7);
    expect(line.taskName).toBe("联通");
    expect(line.client).toBe(UUID);
    expect(line.isAssigned).toBe(true);
    expect(line.loadState).toBe("ready");
    expect(line.loss).toBe(0);
    expect(line.samples).toHaveLength(60);
  });

  it("同一节点的不同三网任务使用不同模拟曲线", () => {
    const makeLine = (taskId: number) =>
      buildFakeHomepagePingLine(
        {
          taskId,
          taskName: `任务 ${taskId}`,
          client: UUID,
          isAssigned: false,
          lastValue: null,
          samples: [],
          max: 1,
          loss: null,
        },
        MINUTE_INDEX,
      );

    expect(makeLine(1).samples.map((sample) => sample.value)).not.toEqual(
      makeLine(2).samples.map((sample) => sample.value),
    );
  });
});
