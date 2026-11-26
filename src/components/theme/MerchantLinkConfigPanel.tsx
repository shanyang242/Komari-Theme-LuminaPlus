import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Search,
  Store,
  X,
} from "lucide-react";
import { clsx } from "clsx";
import { Flag } from "@/components/ui/Flag";
import { MerchantIcon } from "@/components/ui/MerchantIcon";
import { ThemeConfigSaveFooter } from "@/components/theme/ThemeConfigSaveFooter";
import {
  resolveNextSelectedUuid,
  resolvePanelSelectedClient,
} from "@/components/theme/configPanelSelection";
import type { AdminClient } from "@/types/komari";
import type { NodeMerchantLinks } from "@/utils/merchantLinks";

type ConfigFilter = "all" | "configured" | "unconfigured";

const NODE_ROW_HEIGHT = 64;
const NODE_LIST_WINDOW_SIZE = 16;
const NODE_LIST_OVERSCAN = 3;

interface MerchantLinkConfigPanelProps {
  open: boolean;
  clients: AdminClient[];
  links: NodeMerchantLinks;
  saving: boolean;
  saveDisabled: boolean;
  saveError: string | null;
  onChange: (next: NodeMerchantLinks) => void;
  onClose: () => void;
  onSave: () => Promise<boolean>;
}

function isConfigured(links: NodeMerchantLinks, uuid: string) {
  return Boolean(links[uuid]?.url.trim());
}

export function MerchantLinkConfigPanel({
  open,
  clients,
  links,
  saving,
  saveDisabled,
  saveError,
  onChange,
  onClose,
  onSave,
}: MerchantLinkConfigPanelProps) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ConfigFilter>("all");
  const [group, setGroup] = useState("");
  const [selectedUuid, setSelectedUuid] = useState(clients[0]?.uuid ?? "");
  const [mobileEditorOpen, setMobileEditorOpen] = useState(false);
  const [firstVisibleNodeIndex, setFirstVisibleNodeIndex] = useState(0);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const nodeListRef = useRef<HTMLDivElement | null>(null);
  const filterKey = `${filter}\0${group}\0${search}`;
  const prevFilterKeyRef = useRef(filterKey);
  const groups = useMemo(
    () => Array.from(new Set(clients.map((client) => String(client.group || "").trim()).filter(Boolean))),
    [clients],
  );
  const configuredCount = useMemo(
    () => clients.filter((client) => isConfigured(links, client.uuid)).length,
    [clients, links],
  );
  const filteredClients = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return clients.filter((client) => {
      const configured = isConfigured(links, client.uuid);
      if (filter === "configured" && !configured) return false;
      if (filter === "unconfigured" && configured) return false;
      if (group && String(client.group || "").trim() !== group) return false;
      if (!keyword) return true;
      return [client.name, client.uuid, client.group, client.region].some((value) =>
        String(value || "").toLowerCase().includes(keyword),
      );
    });
  }, [clients, filter, group, links, search]);
  const selectedClient = useMemo(
    () => resolvePanelSelectedClient(clients, filteredClients, selectedUuid),
    [clients, filteredClients, selectedUuid],
  );
  const selectedLink = selectedClient
    ? links[selectedClient.uuid] ?? { url: "", iconUrl: "" }
    : { url: "", iconUrl: "" };
  const selectedConfigured = Boolean(selectedLink.url.trim());
  const nodeWindowStart = Math.max(
    0,
    Math.min(
      firstVisibleNodeIndex - NODE_LIST_OVERSCAN,
      Math.max(0, filteredClients.length - NODE_LIST_WINDOW_SIZE),
    ),
  );
  const visibleNodeWindow = filteredClients.slice(
    nodeWindowStart,
    Math.min(
      filteredClients.length,
      nodeWindowStart + NODE_LIST_WINDOW_SIZE + NODE_LIST_OVERSCAN * 2,
    ),
  );

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, open]);

  useEffect(() => {
    if (!open) return;
    const filterChanged = prevFilterKeyRef.current !== filterKey;
    prevFilterKeyRef.current = filterKey;
    const nextUuid = resolveNextSelectedUuid(
      clients,
      filteredClients,
      selectedUuid,
      filterChanged,
    );
    if (nextUuid !== selectedUuid) setSelectedUuid(nextUuid);
  }, [clients, filterKey, filteredClients, open, selectedUuid]);

  useEffect(() => {
    setFirstVisibleNodeIndex(0);
    if (nodeListRef.current) nodeListRef.current.scrollTop = 0;
  }, [filter, group, search]);

  if (!open || typeof document === "undefined") return null;

  const patchSelected = (field: "url" | "iconUrl", value: string) => {
    if (!selectedClient) return;
    const next = { ...links };
    const entry = { ...selectedLink, [field]: value };
    if (!entry.url && !entry.iconUrl) delete next[selectedClient.uuid];
    else next[selectedClient.uuid] = entry;
    onChange(next);
  };

  const clearSelected = () => {
    if (!selectedClient) return;
    const next = { ...links };
    delete next[selectedClient.uuid];
    onChange(next);
  };

  return createPortal(
    <div className="multi-ping-config-backdrop" onMouseDown={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="merchant-config-title"
        className="multi-ping-config-panel"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="multi-ping-config-header">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[11px] font-semibold text-[var(--text-tertiary)]">
              <Store size={14} />
              商家跳转
            </div>
            <h2
              id="merchant-config-title"
              className="mt-1 text-[19px] font-semibold text-[var(--text-primary)]"
            >
              按实例配置商家官网
            </h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="multi-ping-config-icon-button"
            aria-label="关闭配置面板"
            title="关闭"
          >
            <X size={18} />
          </button>
        </header>

        <div className="multi-ping-config-body">
          <aside className={clsx("multi-ping-config-sidebar", mobileEditorOpen && "is-mobile-hidden")}>
            <div className="multi-ping-config-sidebar-tools">
              <label className="surface-inset flex items-center gap-2 px-3 py-2">
                <Search size={14} className="text-[var(--text-tertiary)]" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="搜索实例 / UUID / 地区"
                  aria-label="搜索实例"
                  className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-[var(--text-tertiary)]"
                />
              </label>
              <div className="multi-ping-config-filters" aria-label="配置状态筛选">
                {([
                  ["all", `全部 ${clients.length}`],
                  ["configured", `已配置 ${configuredCount}`],
                  ["unconfigured", `未配置 ${clients.length - configuredCount}`],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={filter === value}
                    onClick={() => setFilter(value)}
                    className={clsx(filter === value && "is-active")}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <select
                value={group}
                onChange={(event) => setGroup(event.target.value)}
                aria-label="按分组筛选实例"
                className="surface-inset w-full px-3 py-2 text-[12px] text-[var(--text-primary)] outline-none"
              >
                <option value="">全部分组</option>
                {groups.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </div>

            <div
              ref={nodeListRef}
              className="multi-ping-config-node-list"
              onScroll={(event) => {
                const nextIndex = Math.floor(
                  event.currentTarget.scrollTop / NODE_ROW_HEIGHT,
                );
                setFirstVisibleNodeIndex((current) =>
                  current === nextIndex ? current : nextIndex,
                );
              }}
            >
              <div
                className="multi-ping-config-node-list-window"
                style={{ height: filteredClients.length * NODE_ROW_HEIGHT }}
              >
              {visibleNodeWindow.map((client, windowIndex) => {
                const index = nodeWindowStart + windowIndex;
                const link = links[client.uuid];
                const configured = Boolean(link?.url.trim());
                return (
                  <button
                    key={client.uuid}
                    type="button"
                    onClick={() => {
                      setSelectedUuid(client.uuid);
                      setMobileEditorOpen(true);
                    }}
                    className={clsx("multi-ping-config-node", selectedClient?.uuid === client.uuid && "is-active")}
                    style={{ transform: `translateY(${index * NODE_ROW_HEIGHT}px)` }}
                    aria-posinset={index + 1}
                    aria-setsize={filteredClients.length}
                  >
                    <Flag region={client.region} size={15} />
                    <span className="min-w-0 flex-1 text-left">
                      <span className="block truncate text-[13px] font-medium text-[var(--text-primary)]">
                        {client.name || client.uuid}
                      </span>
                      <span className="mt-1 block truncate text-[11px] text-[var(--text-tertiary)]">
                        {configured ? link.url : "未配置 · 显示默认图标"}
                      </span>
                    </span>
                    {configured ? (
                      <span className="multi-ping-config-status"><Check size={12} />已配置</span>
                    ) : (
                      <ChevronRight size={15} className="text-[var(--text-tertiary)]" />
                    )}
                  </button>
                );
              })}
              </div>
              {filteredClients.length === 0 && (
                <div className="px-4 py-8 text-center text-[12px] text-[var(--text-tertiary)]">
                  没有匹配的实例。
                </div>
              )}
            </div>
          </aside>

          <main className={clsx("multi-ping-config-editor", mobileEditorOpen && "is-mobile-open")}>
            {selectedClient ? (
              <>
                <div className="multi-ping-config-editor-head">
                  <button
                    type="button"
                    onClick={() => setMobileEditorOpen(false)}
                    className="multi-ping-config-mobile-back"
                  >
                    <ArrowLeft size={15} />
                    实例列表
                  </button>
                  <div className="flex items-start gap-3">
                    <Flag region={selectedClient.region} size={20} />
                    <div className="min-w-0">
                      <h3 className="truncate text-[17px] font-semibold text-[var(--text-primary)]">
                        {selectedClient.name || selectedClient.uuid}
                      </h3>
                      <p className="mt-1 break-all text-[11px] text-[var(--text-tertiary)]">
                        {[selectedClient.group, selectedClient.region, selectedClient.uuid]
                          .filter(Boolean).join(" · ")}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="multi-ping-config-editor-content">
                  <div>
                    <div className="text-[13px] font-medium text-[var(--text-primary)]">
                      商家跳转设置
                    </div>
                    <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
                      官网为空时卡片只显示不可点击的默认商家图标，不会触发跳转。
                    </p>
                  </div>

                  <div className="surface-inset flex items-center gap-3 px-4 py-3">
                    <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-lg bg-[var(--fill-tertiary)] text-[var(--text-tertiary)]">
                      <MerchantIcon
                        enabled={selectedConfigured}
                        iconUrl={selectedConfigured ? selectedLink.iconUrl.trim() : ""}
                        size={15}
                      />
                    </span>
                    <span className="min-w-0">
                      <strong className="block text-[12px] font-medium text-[var(--text-primary)]">
                        卡片图标预览
                      </strong>
                      <span className="mt-1 block text-[11px] text-[var(--text-tertiary)]">
                        {selectedConfigured ? "点击后将在新标签页打开商家官网" : "未配置跳转"}
                      </span>
                    </span>
                  </div>

                  <label className="flex flex-col gap-2">
                    <span className="text-[12px] font-medium text-[var(--text-secondary)]">
                      商家官网地址
                    </span>
                    <input
                      value={selectedLink.url}
                      onChange={(event) => patchSelected("url", event.target.value)}
                      placeholder="https://example.com"
                      className="surface-inset w-full px-3 py-2.5 text-[13px] outline-none"
                    />
                  </label>

                  <label className="flex flex-col gap-2">
                    <span className="text-[12px] font-medium text-[var(--text-secondary)]">
                      商家图标地址（可选）
                    </span>
                    <input
                      value={selectedLink.iconUrl}
                      onChange={(event) => patchSelected("iconUrl", event.target.value)}
                      placeholder="https://example.com/logo.png"
                      className="surface-inset w-full px-3 py-2.5 text-[13px] outline-none"
                    />
                    <span className="text-[11px] leading-relaxed text-[var(--text-tertiary)]">
                      不自动读取网站图标；留空或加载失败时使用默认商家图标。
                    </span>
                  </label>

                  {(selectedLink.url || selectedLink.iconUrl) && (
                    <button
                      type="button"
                      onClick={clearSelected}
                      className="theme-manage-button is-danger self-start"
                    >
                      清除当前实例配置
                    </button>
                  )}
                </div>
              </>
            ) : (
              <div className="flex min-h-[18rem] items-center justify-center text-[13px] text-[var(--text-tertiary)]">
                选择一台实例开始配置。
              </div>
            )}
          </main>
        </div>

        <ThemeConfigSaveFooter
          saving={saving}
          saveDisabled={saveDisabled}
          saveError={saveError}
          onClose={onClose}
          onSave={onSave}
        />
      </section>
    </div>,
    document.body,
  );
}
