import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Save,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { clsx } from "clsx";
import { Flag } from "@/components/ui/Flag";
import { Spinner } from "@/components/ui/Spinner";
import type { AdminClient, PingTask } from "@/types/komari";
import {
  sortHomepagePingTasks,
  type HomepagePingNodeTaskIds,
} from "@/utils/pingTasks";

type ConfigFilter = "all" | "custom" | "auto";
type SelectionMode = "auto" | "manual" | "none";

interface PingNodeConfigPanelProps {
  open: boolean;
  clients: AdminClient[];
  tasks: PingTask[];
  overrides: HomepagePingNodeTaskIds;
  fakePingForUnbound: boolean;
  saving: boolean;
  saveDisabled: boolean;
  saveError: string | null;
  onChange: (next: HomepagePingNodeTaskIds) => void;
  onClose: () => void;
  onSave: () => Promise<boolean>;
}

function hasOverride(overrides: HomepagePingNodeTaskIds, uuid: string) {
  return Object.prototype.hasOwnProperty.call(overrides, uuid);
}

function selectionMode(
  overrides: HomepagePingNodeTaskIds,
  uuid: string,
): SelectionMode {
  if (!hasOverride(overrides, uuid)) return "auto";
  return overrides[uuid] == null ? "none" : "manual";
}

function taskLabel(taskId: number, tasksById: Map<number, PingTask>) {
  return tasksById.get(taskId)?.name || `任务 #${taskId}`;
}

export function PingNodeConfigPanel({
  open,
  clients,
  tasks,
  overrides,
  fakePingForUnbound,
  saving,
  saveDisabled,
  saveError,
  onChange,
  onClose,
  onSave,
}: PingNodeConfigPanelProps) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ConfigFilter>("all");
  const [group, setGroup] = useState("");
  const [selectedUuid, setSelectedUuid] = useState(clients[0]?.uuid ?? "");
  const [mobileEditorOpen, setMobileEditorOpen] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const orderedTasks = useMemo(() => sortHomepagePingTasks(tasks), [tasks]);
  const tasksById = useMemo(
    () => new Map(orderedTasks.map((task) => [task.id, task])),
    [orderedTasks],
  );
  const groups = useMemo(
    () => Array.from(new Set(clients.map((client) => String(client.group || "").trim()).filter(Boolean))),
    [clients],
  );
  const customCount = useMemo(
    () => clients.filter((client) => hasOverride(overrides, client.uuid)).length,
    [clients, overrides],
  );
  const filteredClients = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return clients.filter((client) => {
      const custom = hasOverride(overrides, client.uuid);
      if (filter === "custom" && !custom) return false;
      if (filter === "auto" && custom) return false;
      if (group && String(client.group || "").trim() !== group) return false;
      if (!keyword) return true;
      return [client.name, client.uuid, client.group, client.region].some((value) =>
        String(value || "").toLowerCase().includes(keyword),
      );
    });
  }, [clients, filter, group, overrides, search]);
  const selectedClient = useMemo(
    () => filteredClients.find((client) => client.uuid === selectedUuid) ?? filteredClients[0],
    [filteredClients, selectedUuid],
  );
  const selectedMode = selectedClient
    ? selectionMode(overrides, selectedClient.uuid)
    : "auto";
  const selectedManualTaskId =
    selectedClient && selectedMode === "manual"
      ? (overrides[selectedClient.uuid] ?? undefined)
      : undefined;
  const selectedAutomaticTasks = useMemo(
    () => selectedClient
      ? orderedTasks.filter((task) => task.clients.includes(selectedClient.uuid))
      : [],
    [orderedTasks, selectedClient],
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
    const nextUuid = selectedClient?.uuid ?? "";
    if (nextUuid !== selectedUuid) setSelectedUuid(nextUuid);
  }, [open, selectedClient?.uuid, selectedUuid]);

  if (!open || typeof document === "undefined") return null;

  const patchMode = (mode: SelectionMode) => {
    if (!selectedClient) return;
    const next = { ...overrides };
    if (mode === "auto") delete next[selectedClient.uuid];
    else if (mode === "none") next[selectedClient.uuid] = null;
    else {
      const firstTaskId =
        selectedManualTaskId ?? selectedAutomaticTasks[0]?.id ?? orderedTasks[0]?.id;
      if (firstTaskId == null) return;
      next[selectedClient.uuid] = firstTaskId;
    }
    onChange(next);
  };

  return createPortal(
    <div className="ping-config-backdrop" onMouseDown={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="ping-config-title"
        className="ping-config-panel"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="ping-config-header">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[11px] font-semibold text-[var(--text-tertiary)]">
              <SlidersHorizontal size={14} />
              单网延迟
            </div>
            <h2
              id="ping-config-title"
              className="mt-1 text-[19px] font-semibold text-[var(--text-primary)]"
            >
              按实例配置探测点
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
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="搜索实例 / UUID / 地区"
                  aria-label="搜索实例"
                  className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-[var(--text-tertiary)]"
                />
              </label>
              <div className="ping-config-filters" aria-label="配置状态筛选">
                {([
                  ["all", `全部 ${clients.length}`],
                  ["custom", `自定义 ${customCount}`],
                  ["auto", `自动 ${clients.length - customCount}`],
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

            <div className="ping-config-node-list">
              {filteredClients.map((client) => {
                const mode = selectionMode(overrides, client.uuid);
                const manualTaskId = mode === "manual" ? overrides[client.uuid] : undefined;
                const automaticTask = orderedTasks.find((task) => task.clients.includes(client.uuid));
                const summary = mode === "manual" && manualTaskId != null
                  ? `手动 · ${taskLabel(manualTaskId, tasksById)}`
                  : mode === "none"
                    ? fakePingForUnbound ? "不绑定 · 将模拟" : "不绑定"
                    : automaticTask
                      ? `自动 · ${automaticTask.name || `任务 #${automaticTask.id}`}`
                      : fakePingForUnbound ? "自动 · 未绑定时模拟" : "自动 · 暂无绑定";
                return (
                  <button
                    key={client.uuid}
                    type="button"
                    onClick={() => {
                      setSelectedUuid(client.uuid);
                      setMobileEditorOpen(true);
                    }}
                    className={clsx("ping-config-node", selectedClient?.uuid === client.uuid && "is-active")}
                  >
                    <Flag region={client.region} size={15} />
                    <span className="min-w-0 flex-1 text-left">
                      <span className="block truncate text-[13px] font-medium text-[var(--text-primary)]">
                        {client.name || client.uuid}
                      </span>
                      <span className="mt-1 block truncate text-[11px] text-[var(--text-tertiary)]">
                        {summary}
                      </span>
                    </span>
                    {mode !== "auto" ? (
                      <span className="ping-config-status"><Check size={12} />自定义</span>
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
                          .filter(Boolean).join(" · ")}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="ping-config-editor-content">
                  <div>
                    <div className="text-[13px] font-medium text-[var(--text-primary)]">
                      探测点来源
                    </div>
                    <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
                      自动模式按 Komari 后台任务权重选择该实例已绑定的首个探测点。
                    </p>
                  </div>
                  <div className="ping-config-mode" aria-label="探测点来源">
                    <button type="button" className={clsx(selectedMode === "auto" && "is-active")} onClick={() => patchMode("auto")}>继承自动</button>
                    <button type="button" className={clsx(selectedMode === "manual" && "is-active")} disabled={orderedTasks.length === 0} onClick={() => patchMode("manual")}>手动选择</button>
                    <button type="button" className={clsx(selectedMode === "none" && "is-active")} onClick={() => patchMode("none")}>不绑定</button>
                  </div>

                  {selectedMode === "manual" && (
                    <label className="ping-config-line">
                      <span className="min-w-0 flex-1">
                        <span className="block text-[11px] font-medium text-[var(--text-secondary)]">首页探测点</span>
                        <select
                          value={selectedManualTaskId ?? ""}
                          onChange={(event) => onChange({ ...overrides, [selectedClient.uuid]: Number(event.target.value) })}
                          aria-label={`${selectedClient.name} 首页探测点`}
                          className="surface-inset mt-1.5 w-full px-3 py-2 text-[13px] text-[var(--text-primary)] outline-none"
                        >
                          {selectedManualTaskId != null && !tasksById.has(selectedManualTaskId) && (
                            <option value={selectedManualTaskId}>任务 #{selectedManualTaskId}（当前不可用）</option>
                          )}
                          {orderedTasks.map((task) => (
                            <option key={task.id} value={task.id}>{task.name || `任务 #${task.id}`}</option>
                          ))}
                        </select>
                      </span>
                    </label>
                  )}

                  {selectedMode === "auto" && (
                    <div className="ping-config-summary">
                      <strong>{selectedAutomaticTasks[0]
                        ? selectedAutomaticTasks[0].name || `任务 #${selectedAutomaticTasks[0].id}`
                        : "后台暂未绑定探测点"}</strong>
                      <span>{selectedAutomaticTasks.length > 1
                        ? `共绑定 ${selectedAutomaticTasks.length} 个任务，当前显示权重最前项。`
                        : selectedAutomaticTasks.length === 1
                          ? "实例上线后将自动显示此探测点。"
                          : fakePingForUnbound
                            ? "实例在线时将显示模拟延迟。"
                            : "实例在线时显示未配置。"}</span>
                    </div>
                  )}

                  {selectedMode === "none" && (
                    <div className="ping-config-summary">
                      <strong>不绑定首页探测点</strong>
                      <span>{fakePingForUnbound
                        ? "实例在线时将显示模拟延迟。"
                        : "首页将按未配置状态显示。"}</span>
                    </div>
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

        <footer className="ping-config-footer">
          {saveError ? <span role="alert" className="ping-config-footer-error text-[11px] text-[var(--status-error)]">{saveError}</span> : null}
          <div className="ping-config-footer-actions flex items-center gap-2">
            <button type="button" onClick={onClose} className="theme-manage-button">关闭</button>
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
