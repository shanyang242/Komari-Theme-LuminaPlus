import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useAllNodeMeta, useHomeNodeSummaries } from "@/hooks/useNode";
import { useThemeSettings } from "@/hooks/useThemeSettings";
import { collectMatchingNodeUuids } from "@/utils/nodeIdentity";

// 详情页标题旁的“快速切换服务器”下拉。数据全部来自已建立的 wsStore（详情页本就在跑实时
// 轮询），不发新请求；列表顺序沿用 state.order —— 即后台权重(weight)顺序，与首页/后台一致，
// 不在这里二次排序。
export function InstanceSwitcher({ currentUuid }: { currentUuid: string }) {
  const allMeta = useAllNodeMeta();
  const summaries = useHomeNodeSummaries();
  const { hiddenNodes } = useThemeSettings();
  const { data: me } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  // online 状态在 summaries（含 metrics）里，name 在 allMeta 里，两者都按相同的 state.order
  // 排列；用 uuid 关联，取 online 给小圆点用。
  const onlineByUuid = useMemo(
    () => new Map(summaries.map((node) => [node.uuid, node.online] as const)),
    [summaries],
  );

  // 主题级「隐藏节点」(按名称/UUID 命中)在快速切换里也不展示。
  const hiddenUuids = useMemo(
    () => collectMatchingNodeUuids(allMeta, hiddenNodes),
    [allMeta, hiddenNodes],
  );

  // 与首页完全一致的可见性口径:
  // - 主题级隐藏:对所有人隐藏;
  // - 后台 hidden 标记:仅登录管理员可见,访客一律不显示(即便正停在某个隐藏节点的详情页,
  //   访客也不该在切换列表里看到它)。
  // auth 未就绪时按「访客」处理(fail-closed),不会先冒出隐藏节点再消失。
  const nodes = useMemo(
    () =>
      allMeta
        .filter(
          (node) => !hiddenUuids.has(node.uuid) && (me?.logged_in === true || !node.hidden),
        )
        .map((node) => ({
          uuid: node.uuid,
          name: node.name?.trim() || node.uuid,
          online: onlineByUuid.get(node.uuid) ?? null,
        })),
    [allMeta, hiddenUuids, me?.logged_in, onlineByUuid],
  );

  // 点击外部 / 按 Esc 关闭。
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // 打开时把当前项滚入可视区（节点多时友好）。
  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector<HTMLElement>("[data-active='true']")
      ?.scrollIntoView({ block: "nearest" });
  }, [open]);

  // 只有一个（或没有）节点时没必要显示切换器。
  if (nodes.length <= 1) return null;

  const select = (uuid: string) => {
    setOpen(false);
    if (uuid !== currentUuid) navigate(`/instance/${uuid}`);
  };

  return (
    <div className="instance-switcher" ref={rootRef}>
      <button
        type="button"
        className="instance-switcher-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="切换服务器"
        title="切换服务器"
        onClick={() => setOpen((value) => !value)}
      >
        {/* 收起朝下、展开朝上（单箭头，符合常规习惯） */}
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      {open && (
        <div className="instance-switcher-panel" role="listbox" ref={listRef}>
          {nodes.map((node) => {
            const isActive = node.uuid === currentUuid;
            const status =
              node.online === true ? "online" : node.online === false ? "offline" : "unknown";
            return (
              <button
                key={node.uuid}
                type="button"
                role="option"
                aria-selected={isActive}
                data-active={isActive ? "true" : "false"}
                className="instance-switcher-item"
                onClick={() => select(node.uuid)}
              >
                <span className="instance-switcher-dot" data-status={status} aria-hidden />
                <span className="instance-switcher-name">{node.name}</span>
                {isActive && <Check size={14} className="instance-switcher-check" aria-hidden />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
