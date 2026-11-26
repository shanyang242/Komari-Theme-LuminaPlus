import { useEffect, type ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { useNodeMeta, useNodeMetrics } from "@/hooks/useNode";
import { useMinuteClock } from "@/hooks/useClock";
import { useTodayTrafficStats } from "@/hooks/useTodayTrafficStats";
import { InstanceSwitcher } from "./InstanceSwitcher";
import {
  formatTodayPeakValue,
  formatTodayTrafficValue,
} from "./instanceTodayTrafficFormat";
import {
  formatBytes,
  formatUptimeDays,
} from "@/utils/format";
import { resolveTrafficUsage } from "@/utils/traffic";
import { InstancePanel } from "./InstancePanel";

// Intl.DateTimeFormat 构造开销大，复用一个实例，别每次 metrics 更新都重建
const TIME_FORMATTER = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

export function InstanceDetails({
  uuid,
  onNodeReady,
}: {
  uuid: string;
  onNodeReady?: () => (() => void) | void;
}) {
  const now = useMinuteClock();
  const meta = useNodeMeta(uuid);
  const metrics = useNodeMetrics(uuid);
  const trafficQuery = useTodayTrafficStats([uuid], now, "summary");
  const todayStat = trafficQuery.data?.rows.find((row) => row.uuid === uuid);
  const isReady = Boolean(meta && metrics);

  useEffect(() => {
    if (!isReady) return;
    return onNodeReady?.();
  }, [isReady, onNodeReady, uuid]);

  if (!meta || !metrics) return null;

  const isOnline = metrics.online === true;
  const isOffline = metrics.online === false;
  const statusLabel = isOnline ? "在线" : isOffline ? "离线" : "状态未知";
  const uptime = formatUptimeDays(metrics.uptime);
  // 按 traffic_limit_type (max/sum/up/down/min) 归并上下行，和卡片、后端保持一致——
  // 对非 "sum" 节点直接把上下行相加是错的。
  const trafficUsage = resolveTrafficUsage(
    meta.traffic_limit_type,
    metrics.trafficUp,
    metrics.trafficDown,
    meta.traffic_limit,
  );
  const lastUpdated =
    metrics.updatedAt > 0 ? TIME_FORMATTER.format(metrics.updatedAt) : "—";
  const trimmedName = meta.name?.trim();
  const panelTitle = trimmedName ? `${trimmedName} 信息` : "实例信息";

  return (
    <InstancePanel
      title={panelTitle}
      titleAction={<InstanceSwitcher currentUuid={uuid} />}
      description={
        isOffline
          ? "节点当前离线，实时运行指标已清零，保留累计流量与历史记录。"
          : undefined
      }
    >
      <div className="instance-info-groups">
        <div className="instance-info-group">
          <div className="instance-info-group-title">系统</div>
          <InfoRow label="状态" value={statusLabel} />
          <InfoRow
            label="CPU"
            value={`${meta.cpu_name || "—"}${meta.cpu_cores > 0 ? ` (x${meta.cpu_cores})` : ""}`}
          />
          <InfoRow label="架构" value={meta.arch || "—"} />
          <InfoRow label="虚拟化" value={meta.virtualization || "—"} />
          <InfoRow label="显卡" value={meta.gpu_name || "—"} />
          <InfoRow label="操作系统" value={meta.os || "—"} />
        </div>

        <div className="instance-info-group">
          <div className="instance-info-group-title">资源</div>
          <InfoRow label="内存" value={`${formatBytes(metrics.ramUsed)} / ${formatBytes(metrics.ramTotal)}`} />
          <InfoRow
            label="Swap"
            value={
              metrics.swapTotal > 0
                ? `${formatBytes(metrics.swapUsed)} / ${formatBytes(metrics.swapTotal)}`
                : "无"
            }
          />
          <InfoRow label="磁盘" value={`${formatBytes(metrics.diskUsed)} / ${formatBytes(metrics.diskTotal)}`} />
          <InfoRow
            label="负载"
            value={`${metrics.load1.toFixed(2)} | ${metrics.load5.toFixed(2)} | ${metrics.load15.toFixed(2)}`}
          />
          <InfoRow
            label="运行时长"
            value={uptime.unit ? `${uptime.value} ${uptime.unit}` : uptime.value}
          />
        </div>

        <div className="instance-info-group">
          <div className="instance-info-group-title">网络</div>
          <InfoRow
            label="实时网络"
            value={`↑ ${formatBytes(metrics.netUp)}/s · ↓ ${formatBytes(metrics.netDown)}/s`}
          />
          <InfoRow label={isOffline ? "最后上报" : "最近更新"} value={lastUpdated} />
          <InfoRow
            label="今日流量"
            value={
              <span className="instance-info-inline-value">
                <span>
                  {formatTodayTrafficValue(
                    todayStat,
                    trafficQuery.isPending,
                    trafficQuery.isError,
                  )}
                </span>
                <button
                  type="button"
                  className={`instance-info-refresh${trafficQuery.isFetching ? " is-spinning" : ""}`}
                  onClick={() => void trafficQuery.refetch()}
                  disabled={trafficQuery.isFetching}
                  aria-busy={trafficQuery.isFetching}
                  aria-label="刷新今日流量"
                  title="刷新今日流量"
                >
                  <RefreshCw size={13} strokeWidth={2.2} />
                </button>
              </span>
            }
          />
          <InfoRow
            label="峰值速度"
            value={formatTodayPeakValue(todayStat, trafficQuery.isPending)}
          />
          <div className="instance-info-item is-stack">
            <span className="instance-info-label">总流量</span>
            <div className="instance-info-traffic">
              <span className="instance-info-value">{`↑ ${formatBytes(metrics.trafficUp)} · ↓ ${formatBytes(metrics.trafficDown)}`}</span>
              <div
                className={`instance-progress-track${trafficUsage.unlimited ? " is-unlimited" : ""}`}
                aria-hidden
              >
                {!trafficUsage.unlimited && (
                  <span
                    className="instance-progress-fill"
                    style={{ width: `${trafficUsage.fraction * 100}%` }}
                  />
                )}
              </div>
              <span className="instance-info-note">
                {trafficUsage.unlimited
                  ? `${formatBytes(trafficUsage.used)} / ∞`
                  : `${formatBytes(trafficUsage.used)} / ${formatBytes(trafficUsage.limit)}`}
              </span>
            </div>
          </div>
        </div>
      </div>
    </InstancePanel>
  );
}

function InfoRow({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="instance-info-item">
      <span className="instance-info-label">{label}</span>
      <div className="instance-info-value">{value}</div>
    </div>
  );
}
