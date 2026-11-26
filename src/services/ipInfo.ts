import { z } from "zod";
import { fetchWithTimeout } from "@/utils/abort";

const nullableString = z.string().nullable().default(null);
const nullableNumber = z.number().nullable().default(null);
const nullableBoolean = z.boolean().nullable().default(null);

const IpClassificationSchema = z.object({
  type: z.enum(["native", "broadcast", "anycast", "unknown"]),
  label: nullableString,
  geolocated_country_code: nullableString,
  registered_country_code: nullableString,
  confidence: nullableNumber,
  source: z.string(),
});

const IpInfoStatusEnvelopeSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    available: z.boolean(),
    version: z.string(),
    schema_version: z.number(),
    mainland_china_excluded: z.boolean(),
    capabilities: z.object({
      geo: z.boolean(),
      network: z.boolean(),
      reputation: z.boolean(),
      native_classification: z.boolean().optional(),
      global_latency: z.boolean().optional(),
      media_unlock: z.boolean(),
      ai_unlock: z.boolean(),
    }),
  }),
});

const IpInfoSignalsSchema = z.object({
  country_code: nullableString.optional(),
  proxy: nullableBoolean,
  tor: nullableBoolean,
  vpn: nullableBoolean,
  datacenter: nullableBoolean,
  abuser: nullableBoolean,
  crawler: nullableBoolean,
}).passthrough();

const IpInfoDataSchema = z.object({
  uuid: z.string(),
  schema_version: z.number(),
  excluded: z.boolean(),
  excluded_reason: nullableString,
  address: z.object({
    value: z.string(),
    family: z.union([z.literal(4), z.literal(6)]),
  }),
  location: z.object({
    continent: nullableString,
    continent_code: nullableString.optional(),
    country: nullableString,
    country_code: nullableString,
    registered_country: nullableString.optional(),
    registered_country_code: nullableString.optional(),
    region: nullableString,
    region_code: nullableString.optional(),
    city: nullableString,
    postal_code: nullableString.optional(),
    timezone: nullableString,
    latitude: nullableNumber,
    longitude: nullableNumber,
    accuracy_radius: nullableNumber.optional(),
  }),
  network: z.object({
    asn: nullableString,
    asn_number: nullableNumber,
    organization: nullableString,
    operator: nullableString,
    network_type: nullableString,
    company_type: nullableString.optional(),
    route: nullableString,
    rir: nullableString,
    domain: nullableString,
    datacenter: nullableString,
  }),
  classification: IpClassificationSchema.optional(),
  reputation: z.object({
    available: z.boolean(),
    purity_score: nullableNumber,
    risk_score: nullableNumber,
    pollution_score: nullableNumber,
    risk_level: nullableString,
    pollution_level: nullableString,
    positive_signal_count: z.number().default(0),
    valid_signal_count: z.number().default(0),
    signals: IpInfoSignalsSchema,
    database_scores: z.record(z.string(), nullableNumber).default({}),
    database_signals: z.record(z.string(), IpInfoSignalsSchema.nullable()).default({}),
    available_sources: z.array(z.string()).default([]),
    failed_sources: z.array(z.string()).default([]),
    method: z.object({
      id: z.string(),
      status: z.string(),
    }).passthrough(),
  }),
  capabilities: z.object({
    media_unlock: z.boolean(),
    ai_unlock: z.boolean(),
  }),
  provider: z.object({
    id: z.string(),
    name: z.string(),
    homepage: z.string(),
    base_source: z.string(),
    quality_sources: z.array(z.string()).default([]),
    security_data_available: z.boolean(),
  }).passthrough(),
});

const IpInfoLookupEnvelopeSchema = z.object({
  ok: z.literal(true),
  data: IpInfoDataSchema,
  meta: z.object({
    cache: z.string(),
    stale: z.boolean(),
    updated_at: z.string(),
    expires_at: z.string(),
    stale_until: z.string(),
    warning: nullableString,
  }),
});

const IpNetworkProfileEnvelopeSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    uuid: z.string(),
    schema_version: z.number(),
    address: z.object({
      value: z.string(),
      family: z.union([z.literal(4), z.literal(6)]),
    }),
    classification: IpClassificationSchema,
    latency: z.object({
      nodes: z.array(z.object({
        id: z.string(),
        name: z.string(),
        city: z.string(),
        country_code: z.string(),
        latency_ms: nullableNumber,
        status: z.enum(["ok", "timeout", "unavailable"]),
      })),
      available_count: z.number(),
      timeout_count: z.number(),
      provider_cached: z.boolean(),
    }),
    provider: z.object({
      id: z.string(),
      name: z.string(),
      homepage: z.string(),
      classification_available: z.boolean(),
      latency_available: z.boolean(),
    }),
  }),
  meta: z.object({
    cache: z.string(),
    stale: z.boolean(),
    updated_at: z.string(),
    expires_at: z.string(),
    stale_until: z.string(),
    warning: nullableString,
  }),
});

export type IpInfoStatus = z.output<typeof IpInfoStatusEnvelopeSchema>["data"];
export type IpInfoLookup = z.output<typeof IpInfoLookupEnvelopeSchema> & { queryAddress: string };

export function selectIpClassification(base?: z.input<typeof IpClassificationSchema>, profile?: z.input<typeof IpClassificationSchema>) {
  return base && base.type !== "unknown" && base.label ? base : profile;
}

export function getIpRefreshWarning(payload: unknown): string | null {
  const result = z.object({
    ok: z.literal(true),
    data: z.object({ excluded: z.boolean() }),
    meta: z.object({ stale: z.boolean(), warning: nullableString, latency_warning: nullableString.optional() }),
    related: z.object({ latency: z.object({
      meta: z.object({ stale: z.boolean(), warning: nullableString }),
      data: z.object({ latency: z.object({ available_count: z.number() }) }),
    }).optional() }).optional(),
  }).parse(payload);
  const warnings: string[] = [];
  if (result.meta.stale || result.meta.warning) warnings.push("基础信息未能更新，保留缓存");
  if (!result.data.excluded && (result.meta.latency_warning || !result.related?.latency ||
      result.related.latency.meta.stale || result.related.latency.meta.warning ||
      result.related.latency.data.latency.available_count === 0)) {
    warnings.push("全球延迟未能完整更新，请稍后重试");
  }
  return warnings.join("；") || null;
}

async function fetchAndParse<T>(
  path: string,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetchWithTimeout(
    path,
    {
      credentials: "include",
      cache: "no-store",
      headers: { Accept: "application/json" },
    },
    28_000,
    signal,
  );
  if (!response.ok) throw new Error(`Request ${path} failed: ${response.status}`);
  return schema.parse(await response.json());
}

export async function getIpInfoStatus(signal?: AbortSignal): Promise<IpInfoStatus> {
  const response = await fetchAndParse(
    "/api/public/ip-info/v1/status",
    IpInfoStatusEnvelopeSchema,
    signal,
  );
  return response.data;
}

export async function getIpInfo(uuid: string, ip: string, signal?: AbortSignal): Promise<IpInfoLookup> {
  const query = new URLSearchParams({ uuid, ip });
  const response = await fetchAndParse(
    `/api/public/ip-info/v1/lookup?${query.toString()}`,
    IpInfoLookupEnvelopeSchema,
    signal,
  );
  return { ...response, queryAddress: ip };
}

export function getIpNetworkProfile(uuid: string, ip: string, signal?: AbortSignal) {
  const query = new URLSearchParams({ uuid, ip });
  return fetchAndParse(
    `/api/public/ip-info/v1/latency?${query.toString()}`,
    IpNetworkProfileEnvelopeSchema,
    signal,
  );
}

export async function forceRefreshIpInfo(uuid: string, ip: string, signal?: AbortSignal) {
  const response = await fetchWithTimeout(
    "/api/admin/ip-info/v1/refresh",
    {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ uuid, ip, force: true, include_latency: true }),
    },
    28_000,
    signal,
  );
  const payload = await response.json().catch(() => null) as {
    error?: { message?: string };
  } | null;
  if (!response.ok) {
    throw new Error(payload?.error?.message || `刷新当前 IP 失败（${response.status}）`);
  }
  IpInfoLookupEnvelopeSchema.parse(payload);
  return getIpRefreshWarning(payload);
}
