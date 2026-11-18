import { useCallback, useMemo } from "react";
import { SlidersHorizontal } from "lucide-react";
import { clsx } from "clsx";
import { NodeConfigModal } from "./NodeConfigModal";
import type { AdminClient, PingTask } from "@/types/komari";
import type { HomepagePingNodeTaskIds } from "@/utils/pingTasks";

type SelectionMode = "auto" | "manual" | "none";

const EMPTY_TASKS: PingTask[] = [];

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
  const tasksById = useMemo(
    () => new Map(tasks.map((task) => [task.id, task])),
    [tasks],
  );
  const tasksByClientUuid = useMemo(() => {
    const map = new Map<string, PingTask[]>();
    for (const task of tasks) {
      for (const uuid of task.clients) {
        const list = map.get(uuid);
        if (list) list.push(task);
        else map.set(uuid, [task]);
      }
    }
    return map;
  }, [tasks]);

  const isClientConfigured = useCallback(
    (client: AdminClient) => hasOverride(overrides, client.uuid),
    [overrides],
  );

  const getClientSummary = useCallback(
    (client: AdminClient) => {
      const mode = selectionMode(overrides, client.uuid);
      const manualTaskId = mode === "manual" ? overrides[client.uuid] : undefined;
      const automaticTask = tasksByClientUuid.get(client.uuid)?.[0];
      if (mode === "manual" && manualTaskId != null) {
        return `手动 · ${taskLabel(manualTaskId, tasksById)}`;
      }
      if (mode === "none") {
        return fakePingForUnbound ? "不绑定 · 将模拟" : "不绑定";
      }
      if (automaticTask) {
        return `自动 · ${automaticTask.name || `任务 #${automaticTask.id}`}`;
      }
      return fakePingForUnbound ? "自动 · 未绑定时模拟" : "自动 · 暂无绑定";
    },
    [fakePingForUnbound, overrides, tasksByClientUuid, tasksById],
  );

  const renderEditor = (selectedClient: AdminClient) => {
    const selectedMode = selectionMode(overrides, selectedClient.uuid);
    const selectedManualTaskId =
      selectedMode === "manual" ? (overrides[selectedClient.uuid] ?? undefined) : undefined;
    const selectedAutomaticTasks = tasksByClientUuid.get(selectedClient.uuid) ?? EMPTY_TASKS;

    const patchMode = (mode: SelectionMode) => {
      const next = { ...overrides };
      if (mode === "auto") delete next[selectedClient.uuid];
      else if (mode === "none") next[selectedClient.uuid] = null;
      else {
        const firstTaskId =
          selectedManualTaskId ?? selectedAutomaticTasks[0]?.id ?? tasks[0]?.id;
        if (firstTaskId == null) return;
        next[selectedClient.uuid] = firstTaskId;
      }
      onChange(next);
    };

    return (
      <>
        <div>
          <div className="text-[13px] font-medium text-[var(--text-primary)]">探测点来源</div>
          <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
            自动模式按 Komari 后台任务权重选择该实例已绑定的首个探测点。
          </p>
        </div>
        <div className="ping-config-mode" aria-label="探测点来源">
          <button
            type="button"
            className={clsx(selectedMode === "auto" && "is-active")}
            onClick={() => patchMode("auto")}
          >
            继承自动
          </button>
          <button
            type="button"
            className={clsx(selectedMode === "manual" && "is-active")}
            disabled={tasks.length === 0}
            onClick={() => patchMode("manual")}
          >
            手动选择
          </button>
          <button
            type="button"
            className={clsx(selectedMode === "none" && "is-active")}
            onClick={() => patchMode("none")}
          >
            不绑定
          </button>
        </div>

        {selectedMode === "manual" && (
          <label className="ping-config-line">
            <span className="min-w-0 flex-1">
              <span className="block text-[11px] font-medium text-[var(--text-secondary)]">
                首页探测点
              </span>
              <select
                value={selectedManualTaskId ?? ""}
                onChange={(event) =>
                  onChange({ ...overrides, [selectedClient.uuid]: Number(event.target.value) })
                }
                aria-label={`${selectedClient.name} 首页探测点`}
                className="surface-inset mt-1.5 w-full px-3 py-2 text-[13px] text-[var(--text-primary)] outline-none"
              >
                {selectedManualTaskId != null && !tasksById.has(selectedManualTaskId) && (
                  <option value={selectedManualTaskId}>
                    任务 #{selectedManualTaskId}（当前不可用）
                  </option>
                )}
                {tasks.map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.name || `任务 #${task.id}`}
                  </option>
                ))}
              </select>
            </span>
          </label>
        )}

        {selectedMode === "auto" && (
          <div className="ping-config-summary">
            <strong>
              {selectedAutomaticTasks[0]
                ? selectedAutomaticTasks[0].name || `任务 #${selectedAutomaticTasks[0].id}`
                : "后台暂未绑定探测点"}
            </strong>
            <span>
              {selectedAutomaticTasks.length > 1
                ? `共绑定 ${selectedAutomaticTasks.length} 个任务，当前显示权重最前项。`
                : selectedAutomaticTasks.length === 1
                  ? "实例上线后将自动显示此探测点。"
                  : fakePingForUnbound
                    ? "实例在线时将显示模拟延迟。"
                    : "实例在线时显示未配置。"}
            </span>
          </div>
        )}

        {selectedMode === "none" && (
          <div className="ping-config-summary">
            <strong>不绑定首页探测点</strong>
            <span>
              {fakePingForUnbound ? "实例在线时将显示模拟延迟。" : "首页将按未配置状态显示。"}
            </span>
          </div>
        )}
      </>
    );
  };

  return (
    <NodeConfigModal
      open={open}
      titleId="ping-config-title"
      badgeIcon={<SlidersHorizontal size={14} />}
      badgeLabel="单网延迟"
      title="按实例配置探测点"
      clients={clients}
      configuredFilterLabel="自定义"
      unconfiguredFilterLabel="自动"
      configuredBadgeLabel="自定义"
      saving={saving}
      saveDisabled={saveDisabled}
      saveError={saveError}
      isClientConfigured={isClientConfigured}
      getClientSummary={getClientSummary}
      renderEditor={renderEditor}
      onClose={onClose}
      onSave={onSave}
    />
  );
}
