import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  ChevronRight,
  Save,
  Search,
  X,
} from "lucide-react";
import { clsx } from "clsx";
import { Flag } from "@/components/ui/Flag";
import { Spinner } from "@/components/ui/Spinner";
import type { AdminClient } from "@/types/komari";

type ConfigFilter = "all" | "configured" | "unconfigured";

export function filterConfigClients({
  clients,
  filter,
  group,
  search,
  pinnedUuid,
  isClientConfigured,
}: {
  clients: readonly AdminClient[];
  filter: ConfigFilter;
  group: string;
  search: string;
  /** 正在编辑的实例 UUID：只要仍匹配分组和搜索词，就不因状态变化而中途踢出筛选列表。 */
  pinnedUuid?: string;
  isClientConfigured: (client: AdminClient) => boolean;
}): AdminClient[] {
  const keyword = search.trim().toLowerCase();
  return clients.filter((client) => {
    if (group && String(client.group || "").trim() !== group) return false;
    if (
      keyword &&
      ![client.name, client.uuid, client.group, client.region].some((value) =>
        String(value || "").toLowerCase().includes(keyword),
      )
    ) {
      return false;
    }
    if (pinnedUuid && client.uuid === pinnedUuid) return true;
    const configured = isClientConfigured(client);
    if (filter === "configured" && !configured) return false;
    if (filter === "unconfigured" && configured) return false;
    return true;
  });
}

export function resolveSelectedConfigClient(
  filteredClients: readonly AdminClient[],
  selectedUuid: string,
): AdminClient | undefined {
  if (selectedUuid) {
    const matched = filteredClients.find((client) => client.uuid === selectedUuid);
    if (matched) return matched;
  }
  return filteredClients[0];
}

/** 当所选分组因最后一条记录被移除而不再存在时，自动回退为“全部分组”，保持下拉框与实际过滤一致。 */
export function resolveEffectiveConfigGroup(
  groups: readonly string[],
  group: string,
): string {
  return group && groups.includes(group) ? group : "";
}

interface NodeConfigModalProps {
  open: boolean;
  titleId: string;
  badgeIcon: ReactNode;
  badgeLabel: string;
  title: string;
  clients: AdminClient[];
  initialSelectedUuid?: string;
  configuredFilterLabel: string;
  unconfiguredFilterLabel: string;
  configuredBadgeLabel: string;
  saving: boolean;
  saveDisabled: boolean;
  saveError: string | null;
  isClientConfigured: (client: AdminClient) => boolean;
  isClientInvalid?: (client: AdminClient) => boolean;
  getClientSummary: (client: AdminClient) => string;
  renderEditor: (client: AdminClient) => ReactNode;
  onClose: () => void;
  onSave: () => Promise<boolean>;
}

export function NodeConfigModal({
  open,
  titleId,
  badgeIcon,
  badgeLabel,
  title,
  clients,
  initialSelectedUuid,
  configuredFilterLabel,
  unconfiguredFilterLabel,
  configuredBadgeLabel,
  saving,
  saveDisabled,
  saveError,
  isClientConfigured,
  isClientInvalid,
  getClientSummary,
  renderEditor,
  onClose,
  onSave,
}: NodeConfigModalProps) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ConfigFilter>("all");
  const [group, setGroup] = useState("");
  const [selectedUuid, setSelectedUuid] = useState(
    () => initialSelectedUuid ?? clients[0]?.uuid ?? "",
  );
  const [mobileEditorOpen, setMobileEditorOpen] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  const groups = useMemo(
    () =>
      Array.from(
        new Set(clients.map((client) => String(client.group || "").trim()).filter(Boolean)),
      ),
    [clients],
  );
  const effectiveGroup = resolveEffectiveConfigGroup(groups, group);
  const configuredCount = useMemo(
    () => clients.filter((client) => isClientConfigured(client)).length,
    [clients, isClientConfigured],
  );
  const filteredClients = useMemo(
    () =>
      filterConfigClients({
        clients,
        filter,
        group: effectiveGroup,
        search,
        pinnedUuid: selectedUuid || undefined,
        isClientConfigured,
      }),
    [clients, effectiveGroup, filter, isClientConfigured, search, selectedUuid],
  );

  const selectedClient = useMemo(
    () => resolveSelectedConfigClient(filteredClients, selectedUuid),
    [filteredClients, selectedUuid],
  );

  // 用户主动修改筛选条件/分组/搜索词时，重新按严格条件校验选中项，不保留旧编辑固定项。
  const syncSelectionForCriteria = (
    nextFilter: ConfigFilter,
    nextGroup: string,
    nextSearch: string,
  ) => {
    const strictMatches = filterConfigClients({
      clients,
      filter: nextFilter,
      group: resolveEffectiveConfigGroup(groups, nextGroup),
      search: nextSearch,
      isClientConfigured,
    });
    if (!strictMatches.some((client) => client.uuid === selectedUuid)) {
      setSelectedUuid(strictMatches[0]?.uuid ?? "");
    }
  };

  useEffect(() => {
    if (group && effectiveGroup !== group) {
      setGroup(effectiveGroup);
    }
  }, [effectiveGroup, group]);

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
    const nextUuid = selectedClient?.uuid ?? "";
    if (nextUuid !== selectedUuid) setSelectedUuid(nextUuid);
    if (!nextUuid && mobileEditorOpen) setMobileEditorOpen(false);
  }, [mobileEditorOpen, open, selectedClient?.uuid, selectedUuid]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="ping-config-backdrop" onMouseDown={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="ping-config-panel"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="ping-config-header">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[11px] font-semibold text-[var(--text-tertiary)]">
              {badgeIcon}
              {badgeLabel}
            </div>
            <h2
              id={titleId}
              className="mt-1 text-[19px] font-semibold text-[var(--text-primary)]"
            >
              {title}
            </h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="ping-config-icon-button"
            aria-label="关闭配置面板"
            title="关闭"
          >
            <X size={18} />
          </button>
        </header>

        <div className="ping-config-body">
          <aside className={clsx("ping-config-sidebar", mobileEditorOpen && "is-mobile-hidden")}>
            <div className="ping-config-sidebar-tools">
              <label className="surface-inset flex items-center gap-2 px-3 py-2">
                <Search size={14} className="text-[var(--text-tertiary)]" />
                <input
                  value={search}
                  onChange={(event) => {
                    const nextSearch = event.target.value;
                    setSearch(nextSearch);
                    syncSelectionForCriteria(filter, effectiveGroup, nextSearch);
                  }}
                  placeholder="搜索实例 / UUID / 地区"
                  aria-label="搜索实例"
                  className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-[var(--text-tertiary)]"
                />
              </label>
              <div className="ping-config-filters" aria-label="配置状态筛选">
                {(
                  [
                    ["all", `全部 ${clients.length}`],
                    ["configured", `${configuredFilterLabel} ${configuredCount}`],
                    ["unconfigured", `${unconfiguredFilterLabel} ${clients.length - configuredCount}`],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={filter === value}
                    onClick={() => {
                      setFilter(value);
                      syncSelectionForCriteria(value, effectiveGroup, search);
                    }}
                    className={clsx(filter === value && "is-active")}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <select
                value={effectiveGroup}
                onChange={(event) => {
                  const nextGroup = event.target.value;
                  setGroup(nextGroup);
                  syncSelectionForCriteria(filter, nextGroup, search);
                }}
                aria-label="按分组筛选实例"
                className="surface-inset w-full px-3 py-2 text-[12px] text-[var(--text-primary)] outline-none"
              >
                <option value="">全部分组</option>
                {groups.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </div>

            <div className="ping-config-node-list">
              {filteredClients.map((client) => {
                const invalid = isClientInvalid?.(client) ?? false;
                const configured = isClientConfigured(client);
                return (
                  <button
                    key={client.uuid}
                    type="button"
                    onClick={() => {
                      setSelectedUuid(client.uuid);
                      setMobileEditorOpen(true);
                    }}
                    className={clsx(
                      "ping-config-node",
                      selectedClient?.uuid === client.uuid && "is-active",
                    )}
                  >
                    <Flag region={client.region} size={15} />
                    <span className="min-w-0 flex-1 text-left">
                      <span className="block truncate text-[13px] font-medium text-[var(--text-primary)]">
                        {client.name || client.uuid}
                      </span>
                      <span
                        className={clsx(
                          "mt-1 block truncate text-[11px]",
                          invalid ? "text-[var(--status-offline)]" : "text-[var(--text-tertiary)]",
                        )}
                      >
                        {getClientSummary(client)}
                      </span>
                    </span>
                    {invalid ? (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[color-mix(in_srgb,var(--status-offline)_14%,transparent)] px-2 py-0.5 text-[11px] font-medium text-[var(--status-offline)]">
                        <AlertCircle size={12} />
                        待修正
                      </span>
                    ) : configured ? (
                      <span className="ping-config-status">
                        <Check size={12} />
                        {configuredBadgeLabel}
                      </span>
                    ) : (
                      <ChevronRight size={15} className="text-[var(--text-tertiary)]" />
                    )}
                  </button>
                );
              })}
              {filteredClients.length === 0 && (
                <div className="px-4 py-8 text-center text-[12px] text-[var(--text-tertiary)]">
                  没有匹配的实例。
                </div>
              )}
            </div>
          </aside>

          <main className={clsx("ping-config-editor", mobileEditorOpen && "is-mobile-open")}>
            {selectedClient ? (
              <>
                <div className="ping-config-editor-head">
                  <button
                    type="button"
                    onClick={() => setMobileEditorOpen(false)}
                    className="ping-config-mobile-back"
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
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="ping-config-editor-content">{renderEditor(selectedClient)}</div>
              </>
            ) : (
              <div className="flex min-h-[18rem] items-center justify-center text-[13px] text-[var(--text-tertiary)]">
                选择一台实例开始配置。
              </div>
            )}
          </main>
        </div>

        <footer className="ping-config-footer">
          {saveError ? (
            <span role="alert" className="ping-config-footer-error text-[11px] text-[var(--status-error)]">
              {saveError}
            </span>
          ) : null}
          <div className="ping-config-footer-actions flex items-center gap-2">
            <button type="button" onClick={onClose} className="theme-manage-button">
              关闭
            </button>
            <button
              type="button"
              disabled={saveDisabled || saving}
              onClick={() => void onSave().then((saved) => saved && onClose())}
              className="theme-manage-button is-primary"
            >
              {saving ? <Spinner size={14} /> : <Save size={14} />}
              {saving ? "保存中" : "保存设置"}
            </button>
          </div>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
