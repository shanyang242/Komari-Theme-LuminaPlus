import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Activity, Globe2, RadioTower, RefreshCw } from "lucide-react";
import { InstancePanel } from "@/components/instance/InstancePanel";
import { Flag } from "@/components/ui/Flag";
import { useIpNetworkProfile } from "@/hooks/useIpNetworkProfile";
import { forceRefreshIpInfo, selectIpClassification, type IpInfoLookup } from "@/services/ipInfo";
import { joinDisplayParts } from "@/utils/format";

function joinText(values: Array<string | null | undefined>) {
  return joinDisplayParts(values) || "暂无数据";
}

const UPDATED_AT_FORMATTER = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

function formatUpdatedAt(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return UPDATED_AT_FORMATTER.format(date);
}

function latencyTone(value: number | null | undefined) {
  if (value == null) return "is-unavailable";
  if (value <= 80) return "is-good";
  if (value <= 180) return "is-medium";
  return "is-slow";
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="ip-info-row">
      <span>{label}</span>
      <strong>{value || "暂无数据"}</strong>
    </div>
  );
}

export function IpInfoPanel({ lookups }: { lookups: IpInfoLookup[] }) {
  const queryClient = useQueryClient();
  const families = useMemo(
    () => [...lookups].sort((a, b) => a.data.address.family - b.data.address.family),
    [lookups],
  );
  const [selectedAddress, setSelectedAddress] = useState(families[0]?.data.address.value ?? "");

  useEffect(() => {
    if (!families.some((entry) => entry.data.address.value === selectedAddress)) {
      setSelectedAddress(families[0]?.data.address.value ?? "");
    }
  }, [families, selectedAddress]);

  const selected = families.find((entry) => entry.data.address.value === selectedAddress) ?? families[0];
  const selectedUuid = selected?.data.uuid ?? "";
  const selectedIp = selected?.data.address.value ?? "";
  const networkProfile = useIpNetworkProfile(
    selectedUuid,
    selectedIp,
  );
  const refresh = useMutation({
    mutationFn: ({ uuid, ip }: { uuid: string; ip: string; queryAddress: string }) => forceRefreshIpInfo(uuid, ip),
    onSuccess: async (_data, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["ip-info", "lookup", variables.uuid, variables.queryAddress],
          exact: true,
        }),
        queryClient.invalidateQueries({
          queryKey: ["ip-info", "network-profile", variables.uuid, variables.ip],
          exact: true,
        }),
      ]);
    },
  });
  const resetRefresh = refresh.reset;
  useEffect(() => {
    resetRefresh();
  }, [resetRefresh, selectedIp, selectedUuid]);
  if (!selected) return null;
  const { data, meta } = selected;
  const profile = networkProfile.data;
  const classification = selectIpClassification(data.classification, profile?.data.classification);
  const classificationTitle = classification?.type === "broadcast"
    ? `定位国家 ${classification.geolocated_country_code ?? "未知"}，注册国家 ${classification.registered_country_code ?? "未知"}`
    : classification?.type === "native"
      ? "定位国家与注册国家一致"
      : classification?.type === "anycast"
        ? "该地址使用任播网络"
        : undefined;

  return (
    <InstancePanel
      className="ip-info-panel"
      title="IP 信息"
      description="地理与网络信息由 IP 信息插件提供；全球延迟按需检测。"
      aside={
        <div className="ip-info-panel-actions">
          <span className="ip-info-updated">
            {meta.stale ? "缓存数据" : "更新于"} {formatUpdatedAt(meta.updated_at)}
          </span>
          <button
            type="button"
            className={`ip-info-refresh${refresh.isPending ? " is-spinning" : ""}`}
            onClick={() => refresh.mutate({ uuid: selectedUuid, ip: selectedIp, queryAddress: selected.queryAddress })}
            disabled={refresh.isPending}
            aria-busy={refresh.isPending}
            aria-label={`刷新当前 IPv${data.address.family} 信息`}
            title={`刷新当前 IPv${data.address.family} 的基础信息与全球延迟`}
          >
            <RefreshCw size={13} aria-hidden />
            <span>{refresh.isPending ? "刷新中" : "刷新"}</span>
          </button>
        </div>
      }
    >
      {families.length > 1 && (
        <div className="instance-segmented ip-info-family-switch" aria-label="IP 地址类型">
          {families.map((entry) => (
            <button
              key={entry.data.address.value}
              type="button"
              data-active={entry.data.address.value === data.address.value ? "true" : "false"}
              aria-pressed={entry.data.address.value === data.address.value}
              disabled={refresh.isPending}
              onClick={() => {
                refresh.reset();
                setSelectedAddress(entry.data.address.value);
              }}
            >
              IPv{entry.data.address.family}
            </button>
          ))}
        </div>
      )}

      <div className="ip-info-address">
        <span className="ip-info-family">IPv{data.address.family}</span>
        <strong>{data.address.value}</strong>
        {classification?.label && classification.type !== "unknown" ? (
          <span
            className={`ip-info-native-badge is-${classification.type}`}
            title={classificationTitle}
          >
            {classification.label}
          </span>
        ) : null}
      </div>

      {refresh.isError ? (
        <p className="ip-info-refresh-error" role="status">
          {refresh.error instanceof Error ? refresh.error.message : "刷新失败，请稍后再试。"}
        </p>
      ) : null}
      {refresh.isSuccess && refresh.data ? (
        <p className="ip-info-refresh-error" role="status">{refresh.data}</p>
      ) : null}

      <div className="ip-info-detail-grid">
        <section className="ip-info-section">
          <h3><Globe2 size={15} />地理信息</h3>
          <InfoRow label="位置" value={joinText([data.location.country, data.location.region, data.location.city])} />
          <InfoRow
            label="注册地"
            value={joinText([data.location.registered_country, data.location.registered_country_code])}
          />
          <InfoRow label="时区" value={data.location.timezone ?? "暂无数据"} />
          <InfoRow
            label="坐标"
            value={
              data.location.latitude == null || data.location.longitude == null
                ? "暂无数据"
                : `${data.location.latitude}, ${data.location.longitude}`
            }
          />
        </section>

        <section className="ip-info-section">
          <h3><RadioTower size={15} />网络信息</h3>
          <InfoRow label="ASN" value={data.network.asn ?? "暂无数据"} />
          <InfoRow label="运营商" value={data.network.operator ?? data.network.organization ?? "暂无数据"} />
          <InfoRow label="网络类型" value={data.network.network_type ?? data.network.company_type ?? "暂无数据"} />
          <InfoRow label="网段 / 主机名" value={joinText([data.network.route, data.network.domain])} />
        </section>
      </div>

      <section className="ip-info-section ip-info-latency">
        <div className="ip-info-section-heading">
          <h3><Activity size={15} />全球延迟检测</h3>
          <span>
            {networkProfile.isPending
              ? "检测中"
              : profile
                ? `${profile.data.latency.available_count}/${profile.data.latency.nodes.length} 个节点可用`
                : "暂不可用"}
          </span>
        </div>
        {networkProfile.isPending ? (
          <div className="ip-info-latency-grid" aria-label="正在检测全球延迟">
            {Array.from({ length: 6 }, (_, index) => (
              <div className="ip-info-latency-card is-loading" key={index} />
            ))}
          </div>
        ) : profile?.data.latency.nodes.length ? (
          <div className="ip-info-latency-grid">
            {profile.data.latency.nodes.map((node) => (
              <div className={`ip-info-latency-card ${latencyTone(node.latency_ms)}`} key={node.id}>
                <span className="ip-info-latency-flag" aria-hidden="true">
                  <Flag region={node.country_code} size={16} />
                </span>
                <strong>{node.name}</strong>
                <small>{node.city}</small>
                <b>{node.latency_ms == null ? (node.status === "timeout" ? "超时" : "—") : `${node.latency_ms}ms`}</b>
              </div>
            ))}
          </div>
        ) : (
          <div className="ip-info-latency-empty">
            全球节点暂时无法完成检测，请稍后再试。
          </div>
        )}
        <div className="ip-info-latency-note">
          <span>由 Net.Coffee 全球节点探测，结果缓存 1 小时</span>
          {profile ? (
            <span>{profile.meta.stale ? "缓存数据" : `更新于 ${formatUpdatedAt(profile.meta.updated_at)}`}</span>
          ) : null}
        </div>
      </section>
    </InstancePanel>
  );
}
