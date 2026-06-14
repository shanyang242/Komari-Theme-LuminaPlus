import { z } from "zod";

/** Schemas accept loose/partial payloads from the server, with sensible defaults. */

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
    if (normalized === "" || normalized === "0" || normalized === "false") {
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
    created_at: looseString.default(""),
    updated_at: looseString.default(""),
  })
  .passthrough();

export interface NodeInfo {
  uuid: string;
  name: string;
  group?: string | null;
  region?: string | null;
  hidden: boolean;
  cpu_name: string;
  cpu_cores: number;
  arch: string;
  virtualization: string;
  os: string;
  kernel_version: string;
  gpu_name: string;
  mem_total: number;
  swap_total: number;
  disk_total: number;
  weight: number;
  price: number;
  billing_cycle?: string | null;
  auto_renewal: boolean;
  currency: string;
  expired_at?: string | null;
  tags: string;
  public_remark: string;
  traffic_limit: number;
  traffic_limit_type: string;
  created_at: string;
  updated_at: string;
}

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

/** Display model — flat info + realtime metrics + online flag. */
export interface NodeMetrics {
  online: boolean | null;
  cpuPct: number;
  ramUsed: number;
  ramTotal: number;
  ramPct: number;
  swapUsed: number;
  swapTotal: number;
  swapPct: number;
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
  desktopNodeViewMode?: "large" | "compact";
  mobileNodeViewMode?: "large" | "compact";
  enableAdminButton?: boolean;
  showPingChart?: boolean;
  homepagePingBindings?: Record<string, string[]>;
  showHomeOverview?: boolean;
  showGroupTabs?: boolean;
  homeGroupOrder?: string[];
  moveOfflineNodesBack?: boolean;
  showCostSummary?: boolean;
  compactShowTrafficTotal?: boolean;
  compactShowBilling?: boolean;
  showConnections?: boolean;
  costIgnoredNodes?: string[];
  costRateApiUrl?: string;
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
    custom_head: z.string().default(""),
    custom_body: z.string().default(""),
    theme_settings: z.record(z.string(), z.unknown()).default({}),
  })
  .passthrough();

export interface PublicConfig {
  sitename: string;
  description: string;
  theme: string;
  allow_cors: boolean;
  disable_password_login: boolean;
  oauth_enable: boolean;
  private_site: boolean;
  record_enabled: boolean;
  record_preserve_time: number;
  ping_record_preserve_time: number;
  custom_head: string;
  custom_body: string;
  theme_settings: ThemeSettings & Record<string, unknown>;
}

export const AdminClientSchema = z
  .object({
    uuid: z.string(),
    name: looseString.default(""),
    group: z.union([z.string(), z.number()]).nullish().transform((v) => (v == null ? "" : String(v))),
    region: z.union([z.string(), z.number()]).nullish().transform((v) => (v == null ? "" : String(v))),
    weight: looseNumber.default(0),
  })
  .passthrough();

export interface AdminClient {
  uuid: string;
  name: string;
  group?: string | null;
  region?: string | null;
  weight: number;
}

export const MeSchema = z
  .object({
    logged_in: z.boolean().default(false),
    username: z.string().default(""),
    uuid: z.string().default(""),
  })
  .passthrough();

export interface Me {
  logged_in: boolean;
  username: string;
  uuid: string;
}

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

export interface LoadRecord {
  cpu: number;
  gpu: number;
  ram: number;
  ram_total: number;
  swap: number;
  swap_total: number;
  load: number;
  temp: number;
  disk: number;
  disk_total: number;
  net_in: number;
  net_out: number;
  net_total_up: number;
  net_total_down: number;
  process: number;
  connections: number;
  connections_udp: number;
  time: string | number;
  client: string;
}

export const PingRecordSchema = z
  .object({
    task_id: z.number(),
    time: z.union([z.string(), z.number()]),
    value: z.number(),
    client: z.string().default(""),
  })
  .passthrough();

export interface PingRecord {
  task_id: number;
  time: string | number;
  value: number;
  client: string;
}

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

export interface PingTask {
  id: number;
  interval: number;
  name: string;
  loss: number;
  clients: string[];
  type: string;
  target: string;
  weight: number;
}

export interface LoadRecordsResponse {
  count: number;
  records: LoadRecord[];
}

export interface PingRecordsResponse {
  count: number;
  records: PingRecord[];
  tasks: PingTask[];
}

export const PingBasicInfoSchema = z
  .object({
    client: z.string().default(""),
    loss: z.number().default(0),
    min: z.number().default(0),
    max: z.number().default(0),
  })
  .passthrough();

export interface PingBasicInfo {
  client: string;
  loss: number;
  min: number;
  max: number;
}

export interface PingOverviewItem {
  client: string;
  isAssigned: boolean;
  lastValue: number | null;
  values: number[];
  samples: Array<{ time: number; value: number }>;
  max: number;
  loss: number | null;
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
