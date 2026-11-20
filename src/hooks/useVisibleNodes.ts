import { useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useAllNodeMeta } from "@/hooks/useNode";
import { useThemeSettings } from "@/hooks/useThemeSettings";
import { collectMatchingNodeUuids } from "@/utils/nodeIdentity";
import type { NodeInfo } from "@/types/komari";

let cachedMeta: NodeInfo[] | null = null;
let cachedHidden: string[] | null = null;
let cachedResult: Set<string> | null = null;

function resolveHiddenNodeUuids(allMeta: NodeInfo[], hiddenNodes: string[]): Set<string> {
  if (cachedResult && cachedMeta === allMeta && cachedHidden === hiddenNodes) {
    return cachedResult;
  }
  cachedMeta = allMeta;
  cachedHidden = hiddenNodes;
  cachedResult = collectMatchingNodeUuids(allMeta, hiddenNodes);
  return cachedResult;
}

export function useHiddenNodeUuids(): Set<string> {
  const allMeta = useAllNodeMeta();
  const themeSettings = useThemeSettings();
  const hiddenNodes = themeSettings.hiddenNodes;
  return useMemo(() => resolveHiddenNodeUuids(allMeta, hiddenNodes), [allMeta, hiddenNodes]);
}

/** 节点可见性：后台 hidden 仅管理员可见，主题隐藏全员剔除，未就绪按访客处理。 */
export function useVisibleNodes(): NodeInfo[] {
  const allNodes = useAllNodeMeta();
  const { data: me } = useAuth();
  const hiddenUuids = useHiddenNodeUuids();
  return useMemo(
    () =>
      allNodes.filter(
        (node) => (me?.logged_in === true || !node.hidden) && !hiddenUuids.has(node.uuid),
      ),
    [allNodes, hiddenUuids, me?.logged_in],
  );
}
