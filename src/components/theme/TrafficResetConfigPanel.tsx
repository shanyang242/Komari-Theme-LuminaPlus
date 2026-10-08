import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, Search, X } from "lucide-react";
import { ThemeConfigSaveFooter } from "@/components/theme/ThemeConfigSaveFooter";
import type { AdminClient } from "@/types/komari";
import { getTrafficResetDisplay } from "@/utils/trafficReset";

const DAY_OPTIONS = [
  <option key="default" value="">跟随账单日</option>,
  ...Array.from({ length: 31 }, (_, index) => (
    <option key={index + 1} value={index + 1}>每月 {index + 1} 日</option>
  )),
];

export function TrafficResetConfigPanel({
  clients,
  days,
  now,
  saving,
  saveDisabled,
  saveError,
  onChange,
  onClose,
  onSave,
}: {
  clients: AdminClient[];
  days: Record<string, number>;
  now: number;
  saving: boolean;
  saveDisabled: boolean;
  saveError: string | null;
  onChange: (next: Record<string, number>) => void;
  onClose: () => void;
  onSave: () => Promise<boolean>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [batchDay, setBatchDay] = useState("");
  const customCount = clients.filter((client) => days[client.uuid] != null).length;
  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return clients.filter((client) => {
      const custom = days[client.uuid] != null;
      if (filter === "custom" && !custom) return false;
      if (filter === "default" && custom) return false;
      return [client.name, client.uuid, client.group, client.region].some((value) =>
        value.toLowerCase().includes(keyword),
      );
    });
  }, [clients, days, filter, search]);
  // 批量操作只作用于当前可见且被勾选的节点。
  const selectedClients = filtered.filter((client) => selected.has(client.uuid));
  const allSelected = filtered.length > 0 && selectedClients.length === filtered.length;

  useEffect(() => {
    const dialog = dialogRef.current!;
    const previousOverflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  const applyDay = (uuids: string[], value: string) => {
    const next = { ...days };
    for (const uuid of uuids) {
      if (value === "") delete next[uuid];
      else next[uuid] = Number(value);
    }
    onChange(next);
  };

  return (
    <dialog
      ref={dialogRef}
      className="multi-ping-config-panel traffic-reset-dialog"
      aria-labelledby="traffic-reset-title"
      aria-describedby="traffic-reset-description"
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <header className="multi-ping-config-header">
        <div>
          <h2 id="traffic-reset-title" className="flex items-center gap-2 text-[18px] font-semibold">
            <CalendarDays size={18} />流量重置日
          </h2>
          <p id="traffic-reset-description" className="mt-2 text-[12px] text-[var(--text-secondary)]">
            此设置用于首页流量重置日期提示，请与服务器 Agent 的实际重置日保持一致。
          </p>
          <p className="mt-1 text-[11px] text-[var(--text-tertiary)]">
            已自定义 {customCount} 台，其余跟随账单日（到期日的每月几号）。不足该日取月末。
          </p>
        </div>
        <button type="button" onClick={onClose} className="multi-ping-config-icon-button" aria-label="关闭重置日配置">
          <X size={18} />
        </button>
      </header>

      <div className="flex min-h-0 flex-col">
        <div className="flex flex-wrap items-center gap-3 border-b border-[var(--hairline)] p-4">
          <label className="surface-inset flex min-w-0 flex-1 items-center gap-2 px-3 py-2">
            <Search size={14} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索名称 / UUID / 分组"
              aria-label="搜索重置日服务器"
              className="min-w-0 flex-1 bg-transparent text-[13px] outline-none"
            />
          </label>
          <select
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            aria-label="重置日配置状态"
            className="surface-inset px-3 py-2 text-[13px]"
          >
            <option value="all">全部</option>
            <option value="custom">已自定义</option>
            <option value="default">跟随账单日</option>
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-b border-[var(--hairline)] px-4 py-3 text-[12px]">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={allSelected}
              disabled={filtered.length === 0}
              onChange={(event) => setSelected(new Set(event.target.checked ? filtered.map((client) => client.uuid) : []))}
            />
            全选当前结果
          </label>
          <span className="text-[var(--text-tertiary)]">已选 {selectedClients.length} 台</span>
          <select value={batchDay} onChange={(event) => setBatchDay(event.target.value)} aria-label="批量重置日" className="surface-inset px-3 py-2">
            {DAY_OPTIONS}
          </select>
          <button
            type="button"
            disabled={selectedClients.length === 0}
            onClick={() => {
              applyDay(selectedClients.map((client) => client.uuid), batchDay);
              setSelected(new Set());
            }}
            className="theme-manage-button is-compact"
          >
            应用到所选
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4">
          <div className="traffic-reset-row traffic-reset-columns text-[11px] text-[var(--text-tertiary)]" aria-hidden="true">
            <span /><span>服务器</span><span>重置日设置</span><span>当前生效规则</span><span>下次重置</span>
          </div>
          <ul aria-label="服务器重置日配置">
            {filtered.map((client) => {
              const customDay = days[client.uuid];
              const reset = getTrafficResetDisplay(client.expired_at, now, customDay);
              const name = client.name || client.uuid;
              return (
                <li key={client.uuid} className="traffic-reset-row border-b border-[var(--hairline)] text-[12px]">
                  <input
                    type="checkbox"
                    checked={selected.has(client.uuid)}
                    aria-label={`选择 ${name}`}
                    onChange={(event) => {
                      const next = new Set(selected);
                      if (event.target.checked) next.add(client.uuid);
                      else next.delete(client.uuid);
                      setSelected(next);
                    }}
                  />
                  <div className="min-w-0">
                    <div className="truncate font-medium" title={name}>{name}</div>
                    <div className="mt-1 truncate text-[11px] text-[var(--text-tertiary)]" title={client.uuid}>
                      {client.group || client.uuid}
                    </div>
                  </div>
                  <select
                    value={customDay ?? ""}
                    onChange={(event) => applyDay([client.uuid], event.target.value)}
                    aria-label={`${name} 重置日`}
                    className="surface-inset min-w-0 px-2 py-2"
                  >
                    {DAY_OPTIONS}
                  </select>
                  <span className="traffic-reset-rule text-[var(--text-secondary)]">
                    {reset ? `每月 ${reset.day} 日 · ${customDay != null ? "自定义" : "账单日"}` : "无有效账单日"}
                  </span>
                  <span className="traffic-reset-preview tabular" title={reset?.title}>
                    {reset?.date ?? "—"}
                    {reset && <span className="mt-1 block text-[11px] text-[var(--text-tertiary)]">{reset.label}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
          {filtered.length === 0 && <p className="py-10 text-center text-[13px] text-[var(--text-tertiary)]">没有匹配的服务器。</p>}
        </div>
      </div>

      <ThemeConfigSaveFooter
        saving={saving}
        saveDisabled={saveDisabled}
        saveError={saveError}
        onClose={onClose}
        onSave={onSave}
      />
    </dialog>
  );
}
