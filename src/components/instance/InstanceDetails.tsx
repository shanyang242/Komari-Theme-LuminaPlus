import { useEffect, useRef } from "react";
import { useNodeMeta, useNodeMetrics } from "@/hooks/useNode";
import { InstanceSwitcher } from "./InstanceSwitcher";
import { formatBytes, formatUptimeDays } from "@/utils/format";
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
  const hasAlignedOnReadyRef = useRef(false);

  useEffect(() => {
    hasAlignedOnReadyRef.current = false;
  }, [uuid]);

  useEffect(() => {
    if (!meta || !metrics || hasAlignedOnReadyRef.current) return;
    hasAlignedOnReadyRef.current = true;
    // 触发一次性对齐，但不接收它返回的 cleanup：调用方 (alignCharts) 返回的是给它自己
    // effect 用的 rAF-cancel，这里若接收，后续 meta/metrics 变化会跑这个 cleanup，
    // 在 scroll-into-view 触发前就把它取消掉。
    onNodeReady?.();
  }, [meta, metrics, onNodeReady]);

  if (!meta || !metrics) return null;

  const isOnline = metrics.online;
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
              {meta.traffic_limit > 0 && (
                <>
                  <div className="instance-progress-track" aria-hidden>
                    <span
                      className="instance-progress-fill"
                      style={{ width: `${trafficUsage.fraction * 100}%` }}
                    />
                  </div>
                  <span className="instance-info-note">
                    {`${formatBytes(trafficUsage.used)} / ${formatBytes(meta.traffic_limit)}`}
                  </span>
                </>
              )}
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
  value: string;
}) {
  return (
    <div className="instance-info-item">
      <span className="instance-info-label">{label}</span>
      <div className="instance-info-value">{value}</div>
    </div>
  );
}
