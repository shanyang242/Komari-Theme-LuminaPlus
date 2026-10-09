import { useEffect, type ReactNode } from "react";
import { useNodeMeta, useNodeMetrics } from "@/hooks/useNode";
import { InstanceSwitcher } from "./InstanceSwitcher";
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
  const meta = useNodeMeta(uuid);
  const metrics = useNodeMetrics(uuid);
  const isReady = Boolean(meta && metrics);

  useEffect(() => {
    if (!isReady) return;
    return onNodeReady?.();
  }, [isReady, onNodeReady, uuid]);

  if (!meta || !metrics) return null;

  const isOnline = metrics.online;
  const uptime = formatUptimeDays(metrics.uptime);
  const trafficUsage = resolveTrafficUsage(
    meta.traffic_limit,
    metrics.trafficUsedEffective,
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
        isOnline ? undefined : "节点当前离线，以下展示最近一次上报的缓存数据。"
      }
    >
      <div className="instance-info-groups">
        <div className="instance-info-group">
          <div className="instance-info-group-title">系统</div>
          <InfoRow label="状态" value={isOnline ? "在线" : "离线"} />
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
            label={isOnline ? "实时网络" : "缓存网络"}
            value={`↑ ${formatBytes(metrics.netUp)}/s · ↓ ${formatBytes(metrics.netDown)}/s`}
          />
          <InfoRow label={isOnline ? "最近更新" : "最后上报"} value={lastUpdated} />
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
