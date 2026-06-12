import { useMemo } from "react";
import { useNodeMeta, useNodeMetrics, useNodeTrafficTrend } from "@/hooks/useNode";
import { usePingMini, usePingMiniBuckets } from "@/hooks/usePingMini";
import { formatRenewalPrice } from "@/utils/billing";
import { getExpireTextColor } from "@/utils/expireStatus";
import {
  formatExpireDays,
  formatTrafficRate,
  formatUptimeDays,
  joinDisplayParts,
  parseTags,
} from "@/utils/format";
import { latencyHeatColor, lossHeatColor } from "@/utils/metricTone";
import { resolveOsInfo } from "@/components/ui/OsLogo";

export function useNodeCardModel(uuid: string, pingBucketCount?: number) {
  const meta = useNodeMeta(uuid);
  const metrics = useNodeMetrics(uuid);
  const trafficTrend = useNodeTrafficTrend(uuid);
  const ping = usePingMini(uuid);
  const pingBuckets = usePingMiniBuckets(ping, pingBucketCount);

  return useMemo(() => {
    if (!meta || !metrics) {
      return {
        node: undefined,
        trafficTrend,
        ping,
        pingBuckets,
      };
    }

    const node = { ...meta, ...metrics };
    const tags = parseTags(meta.tags);
    const subtitleParts = [meta.group, meta.public_remark]
      .map((part) => part?.trim())
      .filter((part): part is string => Boolean(part));
    const subtitle = joinDisplayParts(subtitleParts);
    const subtitleLabels = new Set(subtitleParts.map((part) => part.toLowerCase()));
    const compactFooterTags = tags.filter(
      (tag) => !subtitleLabels.has(tag.label.trim().toLowerCase()),
    );
    const fallbackFooterTags =
      tags.length > 0
        ? tags
        : meta.group
          ? [{ label: meta.group, color: "gray" }]
          : [];
    const expire = formatExpireDays(meta.expired_at);
    const loadBaseline = meta.cpu_cores > 0 ? meta.cpu_cores : 4;
    const isOffline = metrics.online === false;

    return {
      node,
      trafficTrend,
      ping,
      pingBuckets,
      tags,
      footerTags: fallbackFooterTags,
      compactFooterTags,
      subtitle,
      expire,
      expireColor: getExpireTextColor(meta.expired_at),
      uptime: formatUptimeDays(metrics.uptime),
      renewalPrice: formatRenewalPrice(meta),
      latencyColor: latencyHeatColor(ping.lastValue),
      lossColor: lossHeatColor(ping.loss),
      loadBaseline,
      loadFraction: Math.max(0, Math.min(1, metrics.load1 / loadBaseline)),
      upRate: formatTrafficRate(metrics.netUp),
      downRate: formatTrafficRate(metrics.netDown),
      hasHomepagePingBinding: ping.isAssigned,
      isOnline: metrics.online === true,
      isOffline,
      // The duration itself is computed in OfflineMask with a ticker so it keeps
      // advancing while the node stays offline (metrics — and thus this memo —
      // stop updating). Here we only expose the last-seen timestamp.
      offlineSince: metrics.updatedAt,
      osName: resolveOsInfo(meta.os).name,
    };
  }, [meta, metrics, ping, pingBuckets, trafficTrend]);
}
