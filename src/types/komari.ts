import { z } from "zod";

/** Schema 接受服务端发来的宽松/不完整数据,并填充合理默认值。 */

const looseString = z
  .union([z.string(), z.number(), z.boolean()])
  .transform((v) => String(v))
  .catch("");
const looseNumber = z
  .union([z.number(), z.string()])
  .transform((v) => (typeof v === "number" ? v : Number.parseFloat(v) || 0))
  .catch(0);
const looseBool = z
  .union([z.boolean(), z.number(), z.string()])
  .transform((v) => {
    if (typeof v === "boolean") return v;
    if (typeof v === "number") return v !== 0;

    const normalized = v.trim().toLowerCase();
    if (
      normalized === "" ||
      normalized === "0" ||
      normalized === "false" ||
      normalized === "no" ||
      normalized === "off"
    ) {
      return false;
    }
    if (normalized === "1" || normalized === "true") {
      return true;
    }

    return Boolean(normalized);
  })
  .catch(false);

export const NodeInfoSchema = z
  .object({
    uuid: z.string(),
    name: looseString.default(""),
    group: z.union([z.string(), z.number()]).nullish().transform((v) => (v == null ? "" : String(v))),
    region: z.union([z.string(), z.number()]).nullish().transform((v) => (v == null ? "" : String(v))),
    hidden: looseBool.default(false),
    cpu_name: looseString.default(""),
    cpu_cores: looseNumber.default(0),
    arch: looseString.default(""),
    virtualization: looseString.default(""),
    os: looseString.default(""),
    kernel_version: looseString.default(""),
    gpu_name: looseString.default(""),
    mem_total: looseNumber.default(0),
    swap_total: looseNumber.default(0),
    disk_total: looseNumber.default(0),
    weight: looseNumber.default(0),
    price: looseNumber.default(0),
    billing_cycle: z.union([z.string(), z.number()]).nullish().transform((v) => (v == null ? "" : String(v))),
    auto_renewal: looseBool.default(false),
    currency: looseString.default(""),
    expired_at: z.union([z.string(), z.number()]).nullish().transform((v) => (v == null ? "" : String(v))),
    tags: looseString.default(""),
    public_remark: looseString.default(""),
    traffic_limit: looseNumber.default(0),
    traffic_limit_type: looseString.default(""),
    ipv4: looseString.default(""),
    ipv6: looseString.default(""),
    created_at: looseString.default(""),
    updated_at: looseString.default(""),
  })
  .passthrough();

export type NodeInfo = z.output<typeof NodeInfoSchema>;

export interface NodeRealtime {
  cpu: { usage: number };
  ram: { total: number; used: number };
  swap: { total: number; used: number };
  load: { load1: number; load5: number; load15: number };
  disk: { total: number; used: number };
  network: { up: number; down: number; totalUp: number; totalDown: number };
  connections: { tcp: number; udp: number };
  uptime: number;
  process: number;
  updated_at?: string | number;
}

/** 展示用模型:扁平化的节点信息 + 实时指标 + 在线标志。 */
export interface NodeMetrics {
  online: boolean | null;
  cpuPct: number;
  ramUsed: number;
  ramTotal: number;
  ramPct: number;
  swapUsed: number;
  swapTotal: number;
  diskUsed: number;
  diskTotal: number;
  diskPct: number;
  netUp: number;
  netDown: number;
  trafficUp: number;
  trafficDown: number;
  uptime: number;
  load1: number;
  load5: number;
  load15: number;
  process: number;
  connectionsTcp: number;
  connectionsUdp: number;
  updatedAt: number;
}

export interface ThemeSettings {
  defaultAppearance?: "system" | "light" | "dark";
  desktopNodeViewMode?: "large" | "compact" | "mini" | "list";
  mobileNodeViewMode?: "large" | "compact" | "mini" | "list";
  enableAdminButton?: boolean;
  showPingChart?: boolean;
  homepagePingBindings?: Record<string, string[]>;
  enableHomepageMultiPing?: boolean;
  homepageMultiPingTaskIds?: number[];
  homepageMultiPingNodeTaskIds?: Record<string, number[]>;
  fakePingForUnbound?: boolean;
  enableHomeHeaderAutoHide?: boolean;
  homeHeaderVisibleSeconds?: number;
  showHomeOverview?: boolean;
  showGroupTabs?: boolean;
  showRegionBar?: boolean;
  showCardGroup?: boolean;
  homeGroupOrder?: string[];
  enableHomeSort?: boolean;
  homeSortField?: "default" | "name" | "speed" | "traffic" | "price";
  homeSortDirection?: "asc" | "desc";
  showCostSummary?: boolean;
  showCostSummaryFloatingButton?: boolean;
  showOverviewRatings?: boolean;
  showTrafficRating?: boolean;
  showBandwidthRating?: boolean;
  showAssetRating?: boolean;
  trafficRatingLabels?: string;
  bandwidthRatingLabels?: string;
  assetRatingLabels?: string;
  compactShowTrafficTotal?: boolean;
  compactShowBilling?: boolean;
  compactShowUptime?: boolean;
  showConnections?: boolean;
  showTodayTrafficPopover?: boolean;
  hiddenNodes?: string[];
  costIgnoredNodes?: string[];
  // 值支持旧版纯数字(自动升格)或 { amount, paidCny?, acquiredAt? } 条目,见 normalizeCostPremiums。
  costPremiums?: Record<
    string,
    number | { amount?: number; paidCny?: number; acquiredAt?: string }
  >;
  costRateApiUrl?: string;
  enableBackgroundImage?: boolean;
  backgroundMediaType?: "image" | "video";
  backgroundImage?: string;
  backgroundImageMobile?: string;
  backgroundVideo?: string;
  backgroundVideoDark?: string;
  backgroundAlignment?: string;
  surfaceOpacity?: number;
}

export const PublicConfigSchema = z
  .object({
    sitename: z.string().default(""),
    description: z.string().default(""),
    theme: z.string().default(""),
    allow_cors: z.boolean().default(false),
    disable_password_login: z.boolean().default(false),
    oauth_enable: z.boolean().default(false),
    private_site: z.boolean().default(false),
    record_enabled: z.boolean().default(true),
    record_preserve_time: z.number().default(0),
    ping_record_preserve_time: z.number().default(0),
    metric_retention_days: z.number().default(0),
    custom_head: z.string().default(""),
    custom_body: z.string().default(""),
    theme_settings: z.record(z.string(), z.unknown()).default({}),
  })
  .passthrough();

export type PublicConfig = z.output<typeof PublicConfigSchema>;

export const AdminClientSchema = z
  .object({
    uuid: z.string(),
    name: looseString.default(""),
    group: z.union([z.string(), z.number()]).nullish().transform((v) => (v == null ? "" : String(v))),
    region: z.union([z.string(), z.number()]).nullish().transform((v) => (v == null ? "" : String(v))),
    weight: looseNumber.default(0),
  })
  .passthrough();

export type AdminClient = z.output<typeof AdminClientSchema>;

export const MeSchema = z
  .object({
    logged_in: z.boolean().default(false),
    username: z.string().default(""),
    uuid: z.string().default(""),
  })
  .passthrough();

export type Me = z.output<typeof MeSchema>;

export const LoadRecordSchema = z
  .object({
    cpu: z.number().default(0),
    gpu: z.number().default(0),
    ram: z.number().default(0),
    ram_total: z.number().default(0),
    swap: z.number().default(0),
    swap_total: z.number().default(0),
    load: z.number().default(0),
    temp: z.number().default(0),
    disk: z.number().default(0),
    disk_total: z.number().default(0),
    net_in: z.number().default(0),
    net_out: z.number().default(0),
    net_total_up: z.number().default(0),
    net_total_down: z.number().default(0),
    process: z.number().default(0),
    connections: z.number().default(0),
    connections_udp: z.number().default(0),
    time: z.union([z.string(), z.number()]),
    client: z.string().default(""),
  })
  .passthrough();

export type LoadRecord = z.output<typeof LoadRecordSchema>;

export const PingRecordSchema = z
  .object({
    task_id: z.number(),
    time: z.union([z.string(), z.number()]),
    value: z.number(),
    client: z.string().default(""),
    count: z.number().optional(),
    loss: z.number().nullable().optional(),
  })
  .passthrough();

export type PingRecord = z.output<typeof PingRecordSchema>;

export const PingTaskSchema = z
  .object({
    id: z.number(),
    interval: z.number().default(60),
    name: z.string().default(""),
    loss: z.number().default(0),
    clients: z.array(z.string()).default([]),
    type: z.string().default("icmp"),
    target: z.string().default(""),
    weight: z.number().default(0),
  })
  .passthrough();

export type PingTask = z.output<typeof PingTaskSchema>;

export interface LoadRecordsResponse {
  count: number;
  records: LoadRecord[];
  rangeStartMs?: number;
  rangeEndMs?: number;
  intervalSeconds?: number;
}

export interface PingRecordsResponse {
  count: number;
  records: PingRecord[];
  tasks: PingTask[];
  /** 新 metric API 实际采用的聚合间隔，用于图表正确识别长区间连续点。 */
  intervalSeconds?: number;
  rangeStartMs?: number;
  rangeEndMs?: number;
  /** 新 metric API 返回的服务端区间统计；旧后端回退时不存在。 */
  stats?: PingTaskStats[];
}

export interface PingTaskStats {
  client: string;
  taskId: number;
  name: string;
  type: string;
  interval: number;
  total: number;
  valid: number;
  loss: number;
  min: number | null;
  max: number | null;
  avg: number | null;
  latest: number | null;
  p50: number | null;
  p99: number | null;
  stddev: number | null;
  p99P50Ratio: number;
}

export type PingOverviewTaskLoadState = "pending" | "ready" | "error";

export interface PingOverviewItem {
  client: string;
  isAssigned: boolean;
  /** 当前任务本轮请求状态；模拟 Ping 不设置此字段。 */
  loadState?: PingOverviewTaskLoadState;
  lastValue: number | null;
  /** metric API 聚合桶的真实宽度；旧 records 接口没有该字段。 */
  metricIntervalMs?: number;
  samples: Array<{
    time: number;
    value: number;
    /** 聚合 metric 点覆盖的原始样本数。 */
    count?: number;
    /** 聚合窗口的丢包百分比。 */
    loss?: number | null;
  }>;
  max: number;
  loss: number | null;
}

export interface HomepagePingLine extends PingOverviewItem {
  taskId: number;
  taskName: string;
}

export interface HomepagePingDisplayLine extends HomepagePingLine {
  buckets: PingOverviewBucket[];
}

export interface TrafficTrendSample {
  value: number;
  level: number;
  opacity: number;
}

export interface PingOverviewBucket {
  index: number;
  value: number | null;
  loss: number | null;
  total: number;
  lost: number;
  startAt: number | null;
  endAt: number | null;
}
