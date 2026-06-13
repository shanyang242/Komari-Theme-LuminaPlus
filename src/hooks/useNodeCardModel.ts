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

  // Meta-derived fields — tag parsing, expiry, renewal price, OS lookup — only
  // change when meta changes (rarely), so they must not recompute on every ~1s
  // metrics tick. Kept in a dedicated memo keyed on meta alone.
  const metaModel = useMemo(() => {
    if (!meta) return null;
    const tags = parseTags(meta.tags);
    const subtitleParts = [meta.group, meta.public_remark]
      .map((part) => part?.trim())
      .filter((part): part is string => Boolean(part));
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
    return {
      tags,
      footerTags: fallbackFooterTags,
      compactFooterTags,
      subtitle: joinDisplayParts(subtitleParts),
      expire: formatExpireDays(meta.expired_at),
      expireColor: getExpireTextColor(meta.expired_at),
      renewalPrice: formatRenewalPrice(meta),
      osName: resolveOsInfo(meta.os).name,
      loadBaseline: meta.cpu_cores > 0 ? meta.cpu_cores : 4,
    };
  }, [meta]);

  // Ping-derived colors only change when the ping item changes.
  const pingModel = useMemo(
    () => ({
      latencyColor: latencyHeatColor(ping.lastValue),
      lossColor: lossHeatColor(ping.loss),
      hasHomepagePingBinding: ping.isAssigned,
    }),
    [ping],
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

    return {
      node: { ...meta, ...metrics },
      trafficTrend,
      ping,
      pingBuckets,
      ...metaModel,
      ...pingModel,
      uptime: formatUptimeDays(metrics.uptime),
      loadFraction: Math.max(0, Math.min(1, metrics.load1 / loadBaseline)),
      upRate: formatTrafficRate(metrics.netUp),
      downRate: formatTrafficRate(metrics.netDown),
      isOnline: metrics.online === true,
      isOffline: metrics.online === false,
      // The duration itself is computed in OfflineMask with a ticker so it keeps
      // advancing while the node stays offline (metrics — and thus this memo —
      // stop updating). Here we only expose the last-seen timestamp.
      offlineSince: metrics.updatedAt,
    };
  }, [meta, metrics, metaModel, pingModel, ping, pingBuckets, trafficTrend]);
}
