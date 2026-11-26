import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import "uplot/dist/uPlot.min.css";
import { InstanceDetails } from "@/components/instance/InstanceDetails";
import { PingChart } from "@/components/instance/PingChart";
import { LoadChart } from "@/components/instance/LoadChart";
import { IpInfoPanel } from "@/components/instance/IpInfoPanel";
import { Spinner } from "@/components/ui/Spinner";
import {
  buildLoadTimeRangeOptions,
  buildPingTimeRangeOptions,
} from "@/components/instance/chartShared";
import { usePublicConfig } from "@/hooks/usePublicConfig";
import { useAuth } from "@/hooks/useAuth";
import { useNodeStoreStatus } from "@/hooks/useNode";
import { useThemeSettings } from "@/hooks/useThemeSettings";
import { useVisibleNodes } from "@/hooks/useVisibleNodes";
import { useIpInfo } from "@/hooks/useIpInfo";

const DEFAULT_PING_HOURS = 4;
type TimeRangeOption = ReturnType<typeof buildLoadTimeRangeOptions>[number];

function RangeSelector({
  ranges,
  value,
  onChange,
}: {
  ranges: TimeRangeOption[];
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="instance-segmented is-scrollable">
      {ranges.map((range) => (
        <button
          key={range.value}
          type="button"
          data-active={value === range.value ? "true" : "false"}
          aria-pressed={value === range.value}
          onClick={() => onChange(range.value)}
        >
          {range.label}
        </button>
      ))}
    </div>
  );
}

export function Instance() {
  const { uuid } = useParams<{ uuid: string }>();
  const { data: config } = usePublicConfig();
  const { data: me, isPending: authPending } = useAuth();
  const themeSettings = useThemeSettings();
  const visibleNodes = useVisibleNodes();
  const meta = useMemo(
    () => (uuid ? visibleNodes.find((node) => node.uuid === uuid) : undefined),
    [uuid, visibleNodes],
  );
  const storeStatus = useNodeStoreStatus(Boolean(uuid));
  const visibilityReady = themeSettings.isReady && !authPending;
  const [chartType, setChartType] = useState<"load" | "ping" | "ip">("load");
  const [loadHours, setLoadHours] = useState(0);
  const [pingHours, setPingHours] = useState(DEFAULT_PING_HOURS);
  const chartControlsRef = useRef<HTMLDivElement | null>(null);

  const metricRetentionHours =
    config?.metric_retention_days && config.metric_retention_days > 0
      ? config.metric_retention_days * 24
      : null;

  const loadRanges = useMemo(
    () => buildLoadTimeRangeOptions(metricRetentionHours ?? config?.record_preserve_time),
    [config?.record_preserve_time, metricRetentionHours],
  );
  const pingRanges = useMemo(
    () => buildPingTimeRangeOptions(metricRetentionHours ?? config?.ping_record_preserve_time),
    [config?.ping_record_preserve_time, metricRetentionHours],
  );
  const showPingChart = themeSettings.isReady && themeSettings.showPingChart;
  const ipInfoEnabled = visibilityReady && Boolean(meta) && me?.logged_in === true;
  const ipInfo = useIpInfo(
    uuid ?? "",
    meta?.ipv4,
    meta?.ipv6,
    meta?.region,
    ipInfoEnabled,
  );

  const alignCharts = useCallback(() => {
    const frame = window.requestAnimationFrame(() => {
      const element = chartControlsRef.current;
      if (!element) return;
      const rect = element.getBoundingClientRect();
      if (rect.top >= 0 && rect.top < window.innerHeight) return;
      element.scrollIntoView({ behavior: "auto", block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!loadRanges.some((range) => range.value === loadHours)) {
      setLoadHours(loadRanges[0]?.value ?? 0);
    }
  }, [loadHours, loadRanges]);

  useEffect(() => {
    if (!pingRanges.some((range) => range.value === pingHours)) {
      setPingHours(
        pingRanges.find((range) => range.value === DEFAULT_PING_HOURS)?.value ??
          pingRanges[0]?.value ??
          DEFAULT_PING_HOURS,
      );
    }
  }, [pingHours, pingRanges]);

  useEffect(() => {
    if (!showPingChart && chartType === "ping") {
      setChartType("load");
    }
  }, [chartType, showPingChart]);

  useEffect(() => {
    if (!ipInfo.available && chartType === "ip") {
      setChartType("load");
    }
  }, [chartType, ipInfo.available]);

  if (!uuid) return null;

  // 主题配置未就绪前不得提前渲染详情或拉取历史数据，避免 hiddenNodes 列表加载前泄露隐藏节点。
  if (!themeSettings.isReady || !meta) {
    const readyToResolveMissing = visibilityReady && storeStatus.hydrated;
    const message = readyToResolveMissing
      ? "找不到这个实例，它可能已被删除、隐藏或链接无效。"
      : storeStatus.nodeInfoError
        ? "节点列表加载失败，系统正在自动重试。"
        : null;
    return (
      <div className="flex flex-col gap-5 py-2">
        <Link to="/" className="instance-page-back">
          <ChevronLeft size={14} />
          返回
        </Link>
        <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
          {message ? (
            <>
              <div className="text-[15px] font-semibold text-[var(--text-primary)]">
                {readyToResolveMissing ? "实例不存在" : "暂时无法加载实例"}
              </div>
              <p className="text-[13px] text-[var(--text-secondary)]">{message}</p>
            </>
          ) : (
            <Spinner size={24} label="正在加载实例" />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 py-2">
      <Link
        to="/"
        className="instance-page-back"
      >
        <ChevronLeft size={14} />
        返回
      </Link>
      <InstanceDetails uuid={uuid} onNodeReady={alignCharts} />
      <div ref={chartControlsRef} className="instance-chart-controls">
        <div className="instance-segmented">
          <button
            type="button"
            data-active={chartType === "load" ? "true" : "false"}
            aria-pressed={chartType === "load"}
            onClick={() => {
              startTransition(() => setChartType("load"));
            }}
          >
            负载
          </button>
          {showPingChart && (
            <button
              type="button"
              data-active={chartType === "ping" ? "true" : "false"}
              aria-pressed={chartType === "ping"}
              onClick={() => {
                startTransition(() => setChartType("ping"));
              }}
            >
              Ping
            </button>
          )}
          {ipInfo.available && (
            <button
              type="button"
              data-active={chartType === "ip" ? "true" : "false"}
              aria-pressed={chartType === "ip"}
              onClick={() => {
                startTransition(() => setChartType("ip"));
              }}
            >
              IP 信息
            </button>
          )}
        </div>
        {chartType === "load" && (
          <RangeSelector
            ranges={loadRanges}
            value={loadHours}
            onChange={(value) => startTransition(() => setLoadHours(value))}
          />
        )}
        {chartType === "ping" && showPingChart && (
          <RangeSelector
            ranges={pingRanges}
            value={pingHours}
            onChange={(value) => startTransition(() => setPingHours(value))}
          />
        )}
      </div>
      <div className="instance-chart-stage">
        <div
          className="instance-chart-view"
          hidden={chartType !== "load"}
          aria-hidden={chartType !== "load"}
        >
          <LoadChart uuid={uuid} hours={loadHours} active={chartType === "load"} />
        </div>
        <div
          className="instance-chart-view"
          hidden={chartType !== "ping"}
          aria-hidden={chartType !== "ping"}
        >
          {showPingChart ? (
            <PingChart
              uuid={uuid}
              hours={pingHours}
              active={chartType === "ping"}
            />
          ) : null}
        </div>
        <div
          className="instance-chart-view"
          hidden={chartType !== "ip"}
          aria-hidden={chartType !== "ip"}
        >
          {chartType === "ip" && ipInfo.available ? (
            <IpInfoPanel key={uuid} lookups={ipInfo.lookups} />
          ) : null}
        </div>
      </div>
    </div>
  );
}
