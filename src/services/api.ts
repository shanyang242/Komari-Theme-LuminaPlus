import { z } from "zod";
import { getRpc2Client } from "@/services/rpc2Client";
import {
  MeSchema,
  NodeInfoSchema,
  PublicConfigSchema,
  AdminClientSchema,
  LoadRecordSchema,
  PingRecordSchema,
  PingTaskSchema,
  type Me,
  type NodeInfo,
  type PublicConfig,
  type AdminClient,
  type LoadRecordsResponse,
  type PingRecordsResponse,
  type PingTask,
  type PingTaskStats,
} from "@/types/komari";
import { fetchWithTimeout } from "@/utils/abort";
import { inferHistoryIntervalSeconds } from "@/utils/historyRange";
const ApiEnvelope = z
  .object({
    status: z.string().optional(),
    message: z.string().optional(),
    data: z.unknown().optional(),
  })
  .passthrough();

const RpcRecordsSchema = z
  .object({
    count: z.number().default(0),
    records: z.unknown().optional(),
    tasks: z.unknown().optional(),
  })
  .passthrough();

const PingMetricStatSchema = z
  .object({
    entity_id: z.string().default(""),
    task_id: z.union([z.string(), z.number()]),
    name: z.string().default(""),
    type: z.string().default("icmp"),
    interval: z.number().default(60),
    total: z.number().default(0),
    valid: z.number().default(0),
    loss: z.number().default(0),
    min: z.number().nullable().optional(),
    max: z.number().nullable().optional(),
    avg: z.number().nullable().optional(),
    latest: z.number().nullable().optional(),
    p50: z.number().nullable().optional(),
    p99: z.number().nullable().optional(),
    stddev: z.number().nullable().optional(),
    p99_p50_ratio: z.number().nullish(),
  })
  .passthrough();

const PingMetricStatsResponseSchema = z
  .object({
    stats: z.array(PingMetricStatSchema).default([]),
  })
  .passthrough();

const LOAD_RECORDS_PER_HOUR = 12;
const PING_RECORDS_PER_HOUR = 240;
const MAX_RPC_RECORDS = 20_000;
const OVERVIEW_PING_MAX_COUNT = 4_000;
// HTTP 接口统一设置传输超时，避免连接半开时无限等待。
const DEFAULT_API_TIMEOUT_MS = 12_000;

interface RpcRecordsPayload {
  count?: number;
  records?: unknown;
  tasks?: unknown;
}

interface PingOverviewResponse {
  records: PingRecordsResponse["records"];
  tasks: PingTask[];
  /** 按任务查询时，后端会返回该任务的节点分配列表。 */
  taskAssignmentsKnown?: boolean;
  rangeStartMs?: number;
  rangeEndMs?: number;
}

interface RequestRange {
  rangeStartMs: number;
  rangeEndMs: number;
}

interface ApiCallOptions {
  signal?: AbortSignal;
  timeout?: number;
}

export class ApiRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly path: string,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

function getRecordsMaxCount(hours: number, recordsPerHour: number) {
  const safeHours = Number.isFinite(hours) && hours > 0 ? hours : 1;
  return Math.min(
    MAX_RPC_RECORDS,
    Math.max(recordsPerHour, Math.ceil(safeHours * recordsPerHour)),
  );
}

function createRequestRange(hours: number, now = Date.now()): RequestRange {
  const safeHours = Number.isFinite(hours) && hours > 0 ? hours : 1;
  return {
    rangeStartMs: now - safeHours * 60 * 60 * 1000,
    rangeEndMs: now,
  };
}

async function apiGet<T>(
  path: string,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  options?: { signal?: AbortSignal; timeout?: number },
): Promise<T> {
  const resp = await fetchWithTimeout(
    path,
    {
      credentials: "include",
      headers: { Accept: "application/json" },
    },
    options?.timeout ?? DEFAULT_API_TIMEOUT_MS,
    options?.signal,
  );
  if (!resp.ok) {
    throw new ApiRequestError(`Request ${path} failed: ${resp.status}`, resp.status, path);
  }
  const json = (await resp.json()) as unknown;
  const envelopeResult = ApiEnvelope.safeParse(json);
  if (envelopeResult.success) {
    const envelope = envelopeResult.data;
    if (envelope.status?.toLowerCase() === "error") {
      throw new ApiRequestError(
        envelope.message || `Request ${path} failed`,
        resp.status,
        path,
      );
    }
    if (Object.prototype.hasOwnProperty.call(envelope, "data")) {
      const dataResult = schema.safeParse(envelope.data);
      if (dataResult.success) return dataResult.data;
      throw new Error(
        `Schema mismatch on ${path}: envelope=${dataResult.error.issues[0]?.message ?? ""}`,
      );
    }
  }
  const rawResult = schema.safeParse(json);
  if (rawResult.success) return rawResult.data;
  // 两种解析错误都抛出来:enveloped 接口看 envelope 错误,裸 array/object 接口看 raw
  // 错误,而这里无法判断接口本该返回哪种结构。
  throw new Error(
    `Schema mismatch on ${path}: envelope=${
      envelopeResult.success ? "" : envelopeResult.error.issues[0]?.message ?? ""
    }; raw=${rawResult.error.issues[0]?.message ?? ""}`,
  );
}

async function rpcCall<T>(
  method: string,
  params: Record<string, unknown>,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  options?: { timeout?: number; signal?: AbortSignal },
): Promise<T> {
  const payload = await getRpc2Client().call(method, params, options);
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new Error(
      `Schema mismatch on rpc:${method}: ${parsed.error.issues[0]?.message ?? ""}`,
    );
  }
  return parsed.data;
}

// 丢掉单条解析失败的记录，避免一条异常数据阻断整个历史记录。
function parseArrayLenient<S extends z.ZodTypeAny>(schema: S, value: unknown): z.infer<S>[] {
  if (!Array.isArray(value)) return [];
  const out: z.infer<S>[] = [];
  for (const item of value) {
    const parsed = schema.safeParse(item);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

function extractRpcRecords(payload: RpcRecordsPayload, key?: string): unknown[] {
  if (Array.isArray(payload.records)) return payload.records;
  if (!payload.records || typeof payload.records !== "object") return [];

  const recordsByKey = payload.records as Record<string, unknown>;
  if (key && Array.isArray(recordsByKey[key])) {
    return recordsByKey[key];
  }

  return Object.values(recordsByKey).flatMap((value) =>
    Array.isArray(value) ? value : [],
  );
}

function normalizeRpcLoadRecords(
  uuid: string,
  payload: RpcRecordsPayload,
  range?: RequestRange,
): LoadRecordsResponse {
  const records = parseArrayLenient(LoadRecordSchema, extractRpcRecords(payload, uuid));
  const count = payload.count;
  return {
    count: typeof count === "number" && Number.isFinite(count) && count > 0 ? count : records.length,
    records,
    intervalSeconds: inferHistoryIntervalSeconds(records),
    ...range,
  };
}

function derivePingTasks(records: PingRecordsResponse["records"]): PingTask[] {
  return Array.from(new Set(records.map((record) => record.task_id)))
    .sort((a, b) => a - b)
    .map((id) => ({
      id,
      interval: 60,
      name: `任务 #${id}`,
      loss: 0,
      clients: [],
      type: "icmp",
      target: "",
      weight: id,
    }));
}

function normalizeRpcPingRecords(
  uuid: string,
  payload: RpcRecordsPayload,
  range?: RequestRange,
): PingRecordsResponse {
  const records = parseArrayLenient(PingRecordSchema, extractRpcRecords(payload, uuid));
  const parsedTasks = z.array(PingTaskSchema).safeParse(payload.tasks);
  const tasks = parsedTasks.success ? parsedTasks.data : derivePingTasks(records);
  const count = payload.count;
  return {
    count: typeof count === "number" && Number.isFinite(count) && count > 0 ? count : records.length,
    records,
    tasks,
    ...range,
  };
}

function normalizeRpcPingOverview(
  payload: RpcRecordsPayload,
  range?: RequestRange,
  taskAssignmentsKnown = false,
): PingOverviewResponse {
  const records = parseArrayLenient(PingRecordSchema, extractRpcRecords(payload));
  const parsedTasks = z.array(PingTaskSchema).safeParse(payload.tasks);
  return {
    records,
    tasks: parsedTasks.success ? parsedTasks.data : derivePingTasks(records),
    taskAssignmentsKnown: taskAssignmentsKnown && parsedTasks.success,
    ...range,
  };
}

function normalizePingMetricStats(
  payload: z.output<typeof PingMetricStatsResponseSchema>,
): PingTaskStats[] {
  return payload.stats.flatMap((item) => {
    const taskId = Number.parseInt(String(item.task_id), 10);
    if (!Number.isFinite(taskId) || taskId <= 0 || !item.entity_id) return [];
    return [{
      client: item.entity_id,
      taskId,
      name: item.name,
      type: item.type,
      interval: item.interval,
      total: item.total,
      valid: item.valid,
      loss: item.loss,
      min: item.min ?? null,
      max: item.max ?? null,
      avg: item.avg ?? null,
      latest: item.latest ?? null,
      p50: item.p50 ?? null,
      p99: item.p99 ?? null,
      stddev: item.stddev ?? null,
      p99P50Ratio: item.p99_p50_ratio ?? 0,
    }];
  });
}

export async function getMe(options?: ApiCallOptions): Promise<Me> {
  // 必须 cast:zod `.passthrough()` schema 经 apiGet 推断出的是 input 类型(默认字段
  // 变可选),这里要重新收窄回来。
  return (await apiGet("/api/me", MeSchema, options)) as Me;
}

export async function getPublic(options?: ApiCallOptions): Promise<PublicConfig> {
  return (await apiGet("/api/public", PublicConfigSchema, options)) as PublicConfig;
}

export async function getNodesLatestStatus(
  uuids?: string[],
  options?: { timeout?: number; signal?: AbortSignal },
): Promise<Record<string, unknown>> {
  return rpcCall(
    "common:getNodesLatestStatus",
    uuids && uuids.length > 0 ? { uuids } : {},
    z.record(z.string(), z.unknown()),
    options,
  );
}

export async function getNodes(options?: ApiCallOptions): Promise<NodeInfo[]> {
  // 修改版后端通过 RPC2 按访客权限下发 V4/V6 标识。
  const map = await rpcCall(
    "common:getNodes",
    {},
    z.record(z.string(), NodeInfoSchema),
    options,
  );
  return Object.values(map) as NodeInfo[];
}

export async function getAdminClients(options?: ApiCallOptions): Promise<AdminClient[]> {
  return (await apiGet("/api/admin/client/list", z.array(AdminClientSchema), options)) as AdminClient[];
}

export async function getLoadRecords(
  uuid: string,
  hours = 6,
  options?: ApiCallOptions,
): Promise<LoadRecordsResponse> {
  const payload = await rpcCall(
    "common:getRecords",
    {
      uuid,
      hours,
      type: "load",
      maxCount: getRecordsMaxCount(hours, LOAD_RECORDS_PER_HOUR),
    },
    RpcRecordsSchema,
    options,
  );
  return normalizeRpcLoadRecords(uuid, payload, createRequestRange(hours));
}

export async function getPingRecords(
  uuid: string,
  hours = 6,
  options?: ApiCallOptions,
): Promise<PingRecordsResponse> {
  const [payload, stats] = await Promise.all([
    rpcCall(
      "common:getRecords",
      {
        uuid,
        hours,
        type: "ping",
        maxCount: getRecordsMaxCount(hours, PING_RECORDS_PER_HOUR),
      },
      RpcRecordsSchema,
      options,
    ),
    rpcCall(
      "public:getPingMetricStats",
      { entity_id: uuid, hours },
      PingMetricStatsResponseSchema,
      options,
    ).then(normalizePingMetricStats).catch((error) => {
      if (options?.signal?.aborted) throw error;
      // 统计请求失败时图表会从记录本地计算，历史记录仍可展示。
      return [] as PingTaskStats[];
    }),
  ]);
  return {
    ...normalizeRpcPingRecords(uuid, payload, createRequestRange(hours)),
    stats,
  };
}

export async function getAdminPingTasks(options?: ApiCallOptions): Promise<PingTask[]> {
  return (await apiGet("/api/admin/ping", z.array(PingTaskSchema), options)) as PingTask[];
}

export async function saveThemeSettings(
  theme: string,
  settings: Record<string, unknown>,
): Promise<void> {
  const resp = await fetchWithTimeout(
    `/api/admin/theme/settings?theme=${encodeURIComponent(theme)}`,
    {
      method: "POST",
      credentials: "include",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(settings),
    },
    DEFAULT_API_TIMEOUT_MS,
  );

  if (!resp.ok) {
    let message = `Request /api/admin/theme/settings failed: ${resp.status}`;
    try {
      const json = (await resp.json()) as { message?: string };
      if (json?.message) {
        message = json.message;
      }
    } catch {
      // body 不是 JSON 时保留兜底错误信息。
    }
    throw new ApiRequestError(message, resp.status, "/api/admin/theme/settings");
  }
}

export async function getPingOverview(
  hours = 1,
  taskId?: number,
  options?: { signal?: AbortSignal; entityIds?: string[] },
): Promise<PingOverviewResponse> {
  const payload = await rpcCall(
    "common:getRecords",
    {
      hours,
      type: "ping",
      ...(taskId != null ? { task_id: taskId } : {}),
      maxCount: OVERVIEW_PING_MAX_COUNT,
    },
    RpcRecordsSchema,
    { signal: options?.signal },
  );
  const overview = normalizeRpcPingOverview(
    payload,
    createRequestRange(hours),
    taskId != null,
  );
  if (!options?.entityIds?.length) return overview;
  const visible = new Set(options.entityIds);
  return {
    ...overview,
    records: overview.records.filter((record) => visible.has(record.client)),
  };
}
