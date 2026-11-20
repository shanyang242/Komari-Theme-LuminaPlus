import type { PingOverviewItem } from "@/types/komari";

// 为未绑定首页 Ping 的节点生成确定性模拟延迟（纯展示）

const FAKE_SAMPLE_COUNT = 60;
const MINUTE_MS = 60_000;
export const FAKE_PING_MIN_MS = 1;
export const FAKE_PING_MAX_MS = 10;

// 基线抬至 3~8ms，使 [0,1)ms 浮动下柱高保持均匀
const FAKE_BASE_MIN_MS = 3;
const FAKE_BASE_SPAN_MS = 5;
const FAKE_NOISE_PERIOD = 12;

function hashUuid(uuid: string) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < uuid.length; i++) {
    hash ^= uuid.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

// 确定性哈希（替代 Math.random 防重渲染闪烁）
function unitAt(seed: number, slot: number) {
  let h = (seed ^ Math.imul(slot, 0x9e3779b9)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x21f0aaad);
  h = Math.imul(h ^ (h >>> 15), 0x735a2d97);
  h = (h ^ (h >>> 15)) >>> 0;
  return h / 0x100000000;
}

function smoothstep(t: number) {
  return t * t * (3 - 2 * t);
}

// 锚点间 smoothstep 插值，分钟推进时序列平滑前移
function smoothUnitAt(seed: number, slot: number) {
  const anchor = Math.floor(slot / FAKE_NOISE_PERIOD);
  const t = slot / FAKE_NOISE_PERIOD - anchor;
  const a = unitAt(seed, anchor);
  const b = unitAt(seed, anchor + 1);
  return a + (b - a) * smoothstep(t);
}

export function buildFakePingItem(uuid: string, minuteIndex: number): PingOverviewItem {
  const seed = hashUuid(uuid);
  const base = FAKE_BASE_MIN_MS + unitAt(seed, 0x9e3779b1) * FAKE_BASE_SPAN_MS;
  const samples = new Array<{ time: number; value: number }>(FAKE_SAMPLE_COUNT);
  let max = 0;
  let lastValue = base;

  for (let i = 0; i < FAKE_SAMPLE_COUNT; i++) {
    const slot = minuteIndex - (FAKE_SAMPLE_COUNT - 1) + i;
    const value = base + smoothUnitAt(seed, slot);
    samples[i] = { time: slot * MINUTE_MS, value };
    if (value > max) max = value;
    lastValue = value;
  }

  return {
    client: uuid,
    isAssigned: true,
    taskName: "延迟",
    lastValue,
    samples,
    max,
    loss: 0,
  };
}
