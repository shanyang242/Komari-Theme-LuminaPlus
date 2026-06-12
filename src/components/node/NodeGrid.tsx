import { useVisibleNodeUuids } from "@/hooks/useNode";
import { useHomepagePingOverview } from "@/hooks/usePingMini";
import { useViewMode } from "@/hooks/useViewMode";
import { CompactNodeCard } from "./CompactNodeCard";
import { CostSummary } from "./CostSummary";
import { NodeCard } from "./NodeCard";

export function NodeGrid() {
  const uuids = useVisibleNodeUuids();
  const { mode } = useViewMode();
  useHomepagePingOverview();

  if (uuids.length === 0) {
    return (
      <>
        <CostSummary />
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
      <div
        className={mode === "compact" ? "grid gap-3 xl:gap-4" : "grid gap-4 xl:gap-5"}
        style={{
          gridTemplateColumns:
            mode === "compact"
              ? "repeat(auto-fill, minmax(min(100%, 340px), 1fr))"
              : "repeat(auto-fill, minmax(min(100%, 360px), 1fr))",
        }}
      >
        {uuids.map((uuid) => (
          <div key={uuid} className="min-w-0">
            {mode === "compact" ? (
              <CompactNodeCard uuid={uuid} />
            ) : (
              <NodeCard uuid={uuid} />
            )}
          </div>
        ))}
      </div>
    </>
  );
}
