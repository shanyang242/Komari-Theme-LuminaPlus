import { useMemo } from "react";
import { useFakePingFallback } from "@/hooks/useFakePing";
import { useHourlyClock } from "@/hooks/useClock";
import { useNodeCardSnapshots } from "@/hooks/useNode";
import {
  useNodePingOverview,
  usePingBuckets,
} from "@/hooks/usePingOverview";
import { useThemeSettings } from "@/hooks/useThemeSettings";
import { formatRenewalPrice } from "@/utils/billing";
import { getExpireTextColor } from "@/utils/expireStatus";
import { getTrafficResetDisplay } from "@/utils/trafficReset";
import {
  formatBytes,
  formatByteRate,
  formatExpireDays,
  formatUptimeDays,
  joinDisplayParts,
  parseTags,
} from "@/utils/format";
import {
  latencyHeatColor,
  lossHeatColor,
  trafficUsageColor,
} from "@/utils/metricTone";
import { resolveTrafficUsage, trafficTypeLabel, type TrafficDisplay } from "@/utils/traffic";
import { resolveOsInfo } from "@/components/ui/OsLogo";

interface NodeCardModelOptions {
  pingBucketCount?: number;
}

export function shouldRenderHomepagePingBars(
  hasRealHomepagePingBinding: boolean,
  pingIsAssigned: boolean,
) {
  return hasRealHomepagePingBinding || pingIsAssigned;
}

export function useNodeCardModel(
  uuid: string,
  { pingBucketCount }: NodeCardModelOptions = {},
) {
  const { meta, metrics, trafficTrend } = useNodeCardSnapshots(uuid);
  const {
    showCardGroup,
    fakePingForUnbound,
  } = useThemeSettings();
  const realPing = useNodePingOverview(uuid);
  const hasRealHomepagePingBinding = realPing.isAssigned;
  const now = useHourlyClock();
  const ping = useFakePingFallback(
    uuid,
    realPing,
    metrics?.online === true,
    fakePingForUnbound,
  );
  // 状态跟随每条任务数据进入 Store,不再订阅全局 isRefreshing。这样后台轮询开始/结束
  // 时不会让所有节点卡片仅因一个布尔值变化而重渲染。
  const pingLoading =
    hasRealHomepagePingBinding && (ping.loadState ?? "pending") === "pending";
  const pingError =
    hasRealHomepagePingBinding && ping.loadState === "error";
  const shouldRenderPingBars = shouldRenderHomepagePingBars(
    hasRealHomepagePingBinding,
    ping.isAssigned,
  );
  const pingBuckets = usePingBuckets(
    ping,
    pingBucketCount,
    true,
  );

  const metaModel = useMemo(() => {
    if (!meta) return null;
    const tags = parseTags(meta.tags);
    const group = showCardGroup ? meta.group : undefined;
    const subtitleParts = [group, meta.public_remark]
      .map((part) => part?.trim())
      .filter((part): part is string => Boolean(part));
    const subtitleLabels = new Set(subtitleParts.map((part) => part.toLowerCase()));
    const compactFooterTags = tags.filter(
      (tag) => !subtitleLabels.has(tag.label.trim().toLowerCase()),
    );
    const fallbackFooterTags =
      tags.length > 0
        ? tags
        : group
          ? [{ label: group, color: "gray" }]
          : [];
    return {
      tags,
      footerTags: fallbackFooterTags,
      compactFooterTags,
      subtitle: joinDisplayParts(subtitleParts),
      expire: formatExpireDays(meta.expired_at, now),
      expireColor: getExpireTextColor(meta.expired_at, now),
      trafficReset: getTrafficResetDisplay(meta.expired_at, now, meta.traffic_reset_day),
      renewalPrice: formatRenewalPrice(meta),
      osName: resolveOsInfo(meta.os).name,
      loadBaseline: meta.cpu_cores > 0 ? meta.cpu_cores : 4,
    };
  }, [meta, now, showCardGroup]);

  // ping 派生的颜色只在 ping item 变化时才变。
  const pingModel = useMemo(
    () => ({
      latencyColor: latencyHeatColor(ping.lastValue),
      lossColor: lossHeatColor(ping.loss),
      hasRealHomepagePingBinding,
      // 保留旧字段供外部模型消费者兼容；它表示真实配置状态。
      hasHomepagePingBinding: hasRealHomepagePingBinding,
      shouldRenderPingBars,
      pingLoading,
      pingError,
    }),
    [
      hasRealHomepagePingBinding,
      ping,
      pingError,
      pingLoading,
      shouldRenderPingBars,
    ],
  );

  return useMemo(() => {
    if (!meta || !metrics || !metaModel) {
      return {
        node: undefined,
        trafficTrend,
        ping,
        pingBuckets,
      };
    }

    const { loadBaseline } = metaModel;

    // 流量配额：按节点的 traffic_limit_type（与后端一致）把累计上/下行算成"已用"，
    // 在这里一次性算出剩余和使用占比，让两种卡片布局共用这套计算。
    const trafficUsage = resolveTrafficUsage(
      meta.traffic_limit_type,
      metrics.trafficUp,
      metrics.trafficDown,
      meta.traffic_limit,
      metrics.trafficUsedEffective,
    );
    const trafficUsedLabel = formatBytes(trafficUsage.used);
    // 不限量时渲染成 ∞，让剩余值和"已用/上限"那行与限量情况保持一致
    //（"剩余 ∞" + "2.73 GB / ∞"）。
    const trafficLimitLabel = trafficUsage.unlimited ? "∞" : formatBytes(trafficUsage.limit);
    const trafficColor = trafficUsage.unlimited
      ? "var(--status-success)"
      : trafficUsageColor(trafficUsage.fraction);
    const traffic: TrafficDisplay = {
      fraction: trafficUsage.fraction,
      color: trafficColor,
      remainingLabel: trafficUsage.unlimited ? "∞" : formatBytes(trafficUsage.remaining),
      detail: `${trafficUsedLabel} / ${trafficLimitLabel}`,
      typeLabel: trafficTypeLabel(meta.traffic_limit_type),
    };

    return {
      node: { ...meta, ...metrics },
      trafficTrend,
      ping,
      pingBuckets,
      traffic,
      ...metaModel,
      ...pingModel,
      uptime: formatUptimeDays(metrics.uptime),
      loadFraction: Math.max(0, Math.min(1, metrics.load1 / loadBaseline)),
      upRate: formatByteRate(metrics.netUp),
      downRate: formatByteRate(metrics.netDown),
      isOnline: metrics.online === true,
      isOffline: metrics.online === false,
    };
  }, [
    meta,
    metrics,
    metaModel,
    pingModel,
    ping,
    pingBuckets,
    trafficTrend,
  ]);
}
