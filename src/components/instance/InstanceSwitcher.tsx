import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useNavigate } from "react-router-dom";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useAllNodeMeta, useNodeOnlineSummaries } from "@/hooks/useNode";
import { useHiddenNodeUuids } from "@/hooks/useVisibleNodes";

export function InstanceSwitcher({ currentUuid }: { currentUuid: string }) {
  const allMeta = useAllNodeMeta();
  const summaries = useNodeOnlineSummaries();
  const hiddenUuids = useHiddenNodeUuids();
  const { data: me } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const listId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const onlineByUuid = useMemo(
    () => new Map(summaries.map((node) => [node.uuid, node.online] as const)),
    [summaries],
  );

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

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const target =
      listRef.current?.querySelector<HTMLButtonElement>("[data-active='true']") ??
      listRef.current?.querySelector<HTMLButtonElement>("[role='option']");
    target?.scrollIntoView({ block: "nearest" });
    target?.focus();
  }, [open]);

  // 只有一个（或没有）节点时没必要显示切换器。
  if (nodes.length <= 1) return null;

  const select = (uuid: string) => {
    triggerRef.current?.focus();
    setOpen(false);
    if (uuid !== currentUuid) navigate(`/instance/${encodeURIComponent(uuid)}`);
  };

  const handleListKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const options = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>("[role='option']") ?? [],
    );
    if (options.length === 0) return;
    event.preventDefault();
    const currentIndex = options.indexOf(document.activeElement as HTMLButtonElement);
    const nextIndex =
      event.key === "Home"
          ? 0
        : event.key === "End"
          ? options.length - 1
          : currentIndex < 0
            ? event.key === "ArrowUp"
              ? options.length - 1
              : 0
          : event.key === "ArrowUp"
            ? (currentIndex - 1 + options.length) % options.length
            : (currentIndex + 1) % options.length;
    options[nextIndex]?.focus();
  };

  const hasActiveNode = nodes.some((node) => node.uuid === currentUuid);

  return (
    <div className="instance-switcher" ref={rootRef}>
      <button
        type="button"
        ref={triggerRef}
        className="instance-switcher-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label="切换服务器"
        title="切换服务器"
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        {open ? <ChevronUp size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}
      </button>
      {open && (
        <div
          id={listId}
          className="instance-switcher-panel"
          role="listbox"
          aria-label="服务器"
          ref={listRef}
          onKeyDown={handleListKeyDown}
        >
          {nodes.map((node, index) => {
            const isActive = node.uuid === currentUuid;
            const status =
              node.online === true ? "online" : node.online === false ? "offline" : "unknown";
            const statusLabel =
              node.online === true ? "在线" : node.online === false ? "离线" : "状态未知";
            return (
              <button
                key={node.uuid}
                type="button"
                role="option"
                aria-selected={isActive}
                tabIndex={isActive || (!hasActiveNode && index === 0) ? 0 : -1}
                data-active={isActive ? "true" : "false"}
                className="instance-switcher-item"
                onClick={() => select(node.uuid)}
              >
                <span className="instance-switcher-dot" data-status={status} aria-hidden />
                <span className="instance-switcher-name">{node.name}</span>
                <span className="sr-only">，{statusLabel}</span>
                {isActive && <Check size={14} className="instance-switcher-check" aria-hidden />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
