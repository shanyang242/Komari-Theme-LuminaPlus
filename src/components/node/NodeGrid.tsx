import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useHomeNodeSummaries } from "@/hooks/useNode";
import type { HomeNodeSummary } from "@/services/wsStore";
import { useHomepagePingOverview } from "@/hooks/usePingMini";
import { useThemeSettings } from "@/hooks/useThemeSettings";
import { useViewMode } from "@/hooks/useViewMode";
import { formatBytes, formatTrafficRateLabel } from "@/utils/format";
import {
  getHomeGroupLabel,
  getHomeGroupOptions,
  HOME_ALL_GROUP,
  sortHomeGroupOptions,
  sortHomeNodeSummaries,
} from "@/utils/homeNodes";
import { CompactNodeCard } from "./CompactNodeCard";
import { CostSummary } from "./CostSummary";
import { NodeCard } from "./NodeCard";

// Joins uuids into a single signature string for memo keying. A comma is safe:
// node uuids are standard UUIDs ([0-9a-f-]) and never contain one.
const UUID_KEY_SEPARATOR = ",";

interface HomeOverview {
  totalNodes: number;
  onlineNodes: number;
  litRegions: number;
  trafficUp: number;
  trafficDown: number;
  netUp: number;
  netDown: number;
}

function formatClock(date: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

function useClock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(new Date());
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  return now;
}

function buildHomeOverview(nodes: HomeNodeSummary[]): HomeOverview {
  const regions = new Set<string>();
  let onlineNodes = 0;
  let trafficUp = 0;
  let trafficDown = 0;
  let netUp = 0;
  let netDown = 0;

  for (const node of nodes) {
    if (node.online === true) {
      onlineNodes += 1;
      if (node.region) regions.add(node.region);
    }
    trafficUp += node.trafficUp;
    trafficDown += node.trafficDown;
    netUp += node.netUp;
    netDown += node.netDown;
  }

  return {
    totalNodes: nodes.length,
    onlineNodes,
    litRegions: regions.size,
    trafficUp,
    trafficDown,
    netUp,
    netDown,
  };
}

function HomeOverviewBar({ overview }: { overview: HomeOverview }) {
  const now = useClock();

  return (
    <section className="home-overview" aria-label="首页总览">
      <div className="home-overview-item">
        <span>当前时间</span>
        <strong>{formatClock(now)}</strong>
      </div>
      <div className="home-overview-item">
        <span>当前在线</span>
        <strong>
          {overview.onlineNodes} / {overview.totalNodes}
        </strong>
      </div>
      <div className="home-overview-item">
        <span>点亮地区</span>
        <strong>{overview.litRegions}</strong>
      </div>
      <div className="home-overview-item is-stack">
        <span>流量概览</span>
        <strong>↑ {formatBytes(overview.trafficUp)}</strong>
        <strong>↓ {formatBytes(overview.trafficDown)}</strong>
      </div>
      <div className="home-overview-item is-stack">
        <span>网络速率</span>
        <strong>↑ {formatTrafficRateLabel(overview.netUp)}</strong>
        <strong>↓ {formatTrafficRateLabel(overview.netDown)}</strong>
      </div>
    </section>
  );
}

function GroupTabs({
  groups,
  selectedGroup,
  onSelectGroup,
}: {
  groups: string[];
  selectedGroup: string;
  onSelectGroup: (group: string) => void;
}) {
  return (
    <div className="home-group-tabs" role="tablist" aria-label="节点分组">
      <button
        type="button"
        role="tab"
        aria-selected={selectedGroup === HOME_ALL_GROUP}
        data-active={selectedGroup === HOME_ALL_GROUP ? "true" : "false"}
        onClick={() => onSelectGroup(HOME_ALL_GROUP)}
      >
        全部节点
      </button>
      {groups.map((group) => (
        <button
          key={group}
          type="button"
          role="tab"
          aria-selected={selectedGroup === group}
          data-active={selectedGroup === group ? "true" : "false"}
          onClick={() => onSelectGroup(group)}
          title={group}
        >
          {group}
        </button>
      ))}
    </div>
  );
}

export function NodeGrid() {
  const nodes = useHomeNodeSummaries();
  const { data: me } = useAuth();
  const themeSettings = useThemeSettings();
  const { mode } = useViewMode();
  const [selectedGroup, setSelectedGroup] = useState(HOME_ALL_GROUP);
  useHomepagePingOverview();

  const visibleNodes = useMemo(
    () => nodes.filter((node) => me?.logged_in === true || !node.hidden),
    [me?.logged_in, nodes],
  );
  const overview = useMemo(() => buildHomeOverview(visibleNodes), [visibleNodes]);
  const groupOptions = useMemo(
    () => sortHomeGroupOptions(getHomeGroupOptions(visibleNodes), themeSettings.homeGroupOrder),
    [visibleNodes, themeSettings.homeGroupOrder],
  );
  const filteredNodes = useMemo(() => {
    const filtered =
      selectedGroup === HOME_ALL_GROUP
        ? visibleNodes
        : visibleNodes.filter((node) => getHomeGroupLabel(node.group) === selectedGroup);
    return sortHomeNodeSummaries(filtered, themeSettings.moveOfflineNodesBack);
  }, [visibleNodes, selectedGroup, themeSettings.moveOfflineNodesBack]);

  useEffect(() => {
    if (selectedGroup !== HOME_ALL_GROUP && !groupOptions.includes(selectedGroup)) {
      setSelectedGroup(HOME_ALL_GROUP);
    }
  }, [groupOptions, selectedGroup]);

  // The summary objects get a fresh reference every ~1s tick, so filteredNodes
  // (and a naive uuids map) rebuild constantly. Key the rendered card list on a
  // stable uuid signature instead, so the list only re-renders when the set or
  // order actually changes — each card subscribes to its own store slices and
  // updates independently.
  const uuidsKey = useMemo(
    () => filteredNodes.map((node) => node.uuid).join(UUID_KEY_SEPARATOR),
    [filteredNodes],
  );
  const cards = useMemo(() => {
    const uuids = uuidsKey ? uuidsKey.split(UUID_KEY_SEPARATOR) : [];
    return uuids.map((uuid) => (
      <div key={uuid} className="min-w-0">
        {mode === "compact" ? <CompactNodeCard uuid={uuid} /> : <NodeCard uuid={uuid} />}
      </div>
    ));
  }, [uuidsKey, mode]);
  const showGroupTabs = themeSettings.showGroupTabs && groupOptions.length > 0;

  if (visibleNodes.length === 0) {
    return (
      <>
        <CostSummary />
        {themeSettings.showHomeOverview && <HomeOverviewBar overview={overview} />}
        <div className="flex h-[40vh] flex-col items-center justify-center gap-2 text-[var(--text-tertiary)]">
          <span className="text-[15px]">尚未连接到任何节点</span>
          <span className="text-[12px]">等待后端推送或前往管理后台添加</span>
        </div>
      </>
    );
  }

  return (
    <>
      <CostSummary />
      {themeSettings.showHomeOverview && <HomeOverviewBar overview={overview} />}
      {showGroupTabs && (
        <GroupTabs
          groups={groupOptions}
          selectedGroup={selectedGroup}
          onSelectGroup={setSelectedGroup}
        />
      )}
      <div
        className={mode === "compact" ? "grid gap-3 xl:gap-4" : "grid gap-4 xl:gap-5"}
        style={{
          gridTemplateColumns:
            mode === "compact"
              ? "repeat(auto-fill, minmax(min(100%, 340px), 1fr))"
              : "repeat(auto-fill, minmax(min(100%, 360px), 1fr))",
        }}
      >
        {cards}
      </div>
    </>
  );
}
