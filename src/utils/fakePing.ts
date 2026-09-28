import type { PingOverviewItem } from "@/types/komari";

// 未绑定首页 Ping 任务的节点用这份前端生成的"模拟延迟"填充卡片,避免与已绑定节点混排时出现
// "未配置"占位。纯展示数据:不发请求、不代表真实网络质量,是否启用由 fakePingForUnbound 决定。

// 最近一小时、每分钟一个样本,经 usePingBuckets 聚合成首页 24 桶。
const FAKE_SAMPLE_COUNT = 60;
const MINUTE_MS = 60_000;
export const FAKE_PING_MIN_MS = 1;
export const FAKE_PING_MAX_MS = 10;

// 每个节点固定一条基线延迟,样本在其上做 [0,1)ms 的极小平滑浮动。柱高是 value/窗口最大值 的相对
// 值,基线太低时 ±1ms 就是很大的相对跳变;基线抬到 3~8ms 后相对起伏很小,柱子偏高且均匀。
const FAKE_BASE_MIN_MS = 3;
const FAKE_BASE_SPAN_MS = 5;
const FAKE_NOISE_PERIOD = 12;

// FNV-1a:把 uuid 折叠成 32 位种子,让每个节点的曲线形态互不相同。
function hashUuid(uuid: string) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < uuid.length; i++) {
    hash ^= uuid.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

// splitmix32 终混:同一 (seed, slot) 永远得到同一个 [0,1) 值。刻意不用 Math.random(),否则每次
// 渲染都会重掷导致柱子闪烁(StrictMode 还会双渲染)。
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

// 只在每 FAKE_NOISE_PERIOD 个分钟槽的锚点取随机,锚点间 smoothstep 插值 —— 得到缓慢起伏而非
// 逐格白噪声。只依赖绝对分钟槽,所以分钟推进时序列整体前移一格、旧值不变。
function smoothUnitAt(seed: number, slot: number) {
  const anchor = Math.floor(slot / FAKE_NOISE_PERIOD);
  const t = slot / FAKE_NOISE_PERIOD - anchor;
  const a = unitAt(seed, anchor);
  const b = unitAt(seed, anchor + 1);
  return a + (b - a) * smoothstep(t);
}

/**
 * 生成未绑定节点的模拟 PingOverviewItem。`minuteIndex` 是绝对分钟槽 Math.floor(now / 60000):
 * 每个点由 (uuid, 分钟槽) 唯一确定,分钟推进时序列前移一格、只新增最新点,与真实滚动窗口一致。
 */
export function buildFakePingItem(uuid: string, minuteIndex: number): PingOverviewItem {
  const seed = hashUuid(uuid);
  // 基线只由 seed 决定,落在 [3,8];叠加浮动后 ∈ [3,9] ⊂ [1,10]。样本存浮点,显示端 Math.round。
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
    lastValue,
    samples,
    max,
    loss: 0,
  };
}
