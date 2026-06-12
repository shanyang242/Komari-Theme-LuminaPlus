import type { PingOverviewBucket } from "@/types/komari";
import { trimFixed } from "@/utils/format";

export function formatPingBucketWindow(bucket: PingOverviewBucket | null) {
  if (!bucket || bucket.startAt == null || bucket.endAt == null) {
    return null;
  }

  const start = new Date(bucket.startAt);
  const end = new Date(bucket.endAt);
  const startText = `${start.getHours().toString().padStart(2, "0")}:${start
    .getMinutes()
    .toString()
    .padStart(2, "0")}`;
  const endText = `${end.getHours().toString().padStart(2, "0")}:${end
    .getMinutes()
    .toString()
    .padStart(2, "0")}`;
  return `${startText} - ${endText}`;
}

export function formatLatencyBucketSummary(bucket: PingOverviewBucket | null) {
  if (!bucket) return "—";
  if (bucket.value != null) return `${trimFixed(bucket.value, 1)} ms`;
  return bucket.total > 0 ? "失败" : "无样本";
}

export function formatLossBucketSummary(
  bucket: PingOverviewBucket | null,
  separator = " ",
) {
  if (!bucket) return "—";
  if (bucket.total <= 0 || bucket.loss == null) return "无样本";
  return `${trimFixed(bucket.loss, 1)}%${separator}${bucket.lost}/${bucket.total}`;
}

export function formatHealthBucketTooltip(
  bucket: PingOverviewBucket,
  kind: "latency" | "loss",
) {
  const window = formatPingBucketWindow(bucket);
  const summary =
    kind === "latency"
      ? formatLatencyBucketSummary(bucket)
      : formatLossBucketSummary(bucket, " · ");
  return window ? `${window} · ${summary}` : summary;
}
