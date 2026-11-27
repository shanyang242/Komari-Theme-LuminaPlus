import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { CircleDollarSign, X } from "lucide-react";
import {
  EMPTY_RENEWAL_REMINDER_PREFERENCES,
  formatRenewalReminderExpiry,
  getRenewalReminders,
  getVisibleRenewalReminders,
  RENEWAL_SNOOZE_DAYS,
  RENEWAL_SNOOZE_MS,
  RENEWAL_WARNING_DAYS,
  renewalCycleKey,
  type RenewalReminderPreferences,
  type RenewalReminderSource,
} from "@/utils/renewalReminder";

const STORAGE_KEY = "lumina-renewal-reminders-v1";
const MAX_VISIBLE_ROWS = 4;
const CLOCK_REFRESH_MS = 60 * 60 * 1000;

function parseCycleKey(cycleKey: string): { uuid: string; expiresAt: number } | null {
  const splitAt = cycleKey.lastIndexOf(":");
  if (splitAt <= 0 || splitAt === cycleKey.length - 1) return null;
  const uuid = cycleKey.slice(0, splitAt);
  const expiresAt = Number(cycleKey.slice(splitAt + 1));
  if (!uuid || !Number.isFinite(expiresAt)) return null;
  return { uuid, expiresAt };
}

export function pruneRenewalReminderPreferences(
  preferences: RenewalReminderPreferences,
  nodes: RenewalReminderSource[] = [],
  now = Date.now(),
): RenewalReminderPreferences {
  const currentCycleByUuid = new Map<string, string | null>();
  for (const node of nodes) {
    currentCycleByUuid.set(node.uuid, renewalCycleKey(node));
  }
  const keepCycleKey = (cycleKey: string) => {
    const parsed = parseCycleKey(cycleKey);
    if (!parsed) return false;
    if (currentCycleByUuid.has(parsed.uuid)) {
      // 仅在当前列表能确认节点到期周期变化时，清理其旧周期记录。
      return currentCycleByUuid.get(parsed.uuid) === cycleKey;
    }
    // 列表可能尚未加载，或经过鉴权/主题可见性过滤；缺席不能证明节点已删除。
    // 保留未知节点的忽略记录，稍后提醒的时间过期仍在下方正常清理。
    return true;
  };

  const dismissedCycles = Array.from(
    new Set(preferences.dismissedCycles.filter(keepCycleKey)),
  );
  const snoozedUntil: Record<string, number> = {};
  for (const [cycleKey, until] of Object.entries(preferences.snoozedUntil)) {
    if (!Number.isFinite(until) || until <= now) continue;
    if (!keepCycleKey(cycleKey)) continue;
    snoozedUntil[cycleKey] = until;
  }

  return { dismissedCycles, snoozedUntil };
}

function equalRenewalPreferences(
  left: RenewalReminderPreferences,
  right: RenewalReminderPreferences,
) {
  if (left.dismissedCycles.length !== right.dismissedCycles.length) return false;
  if (!left.dismissedCycles.every((key, index) => key === right.dismissedCycles[index])) {
    return false;
  }
  const leftEntries = Object.entries(left.snoozedUntil);
  const rightKeys = Object.keys(right.snoozedUntil);
  if (leftEntries.length !== rightKeys.length) return false;
  return leftEntries.every(([key, value]) => right.snoozedUntil[key] === value);
}

function readPreferences(now = Date.now()): RenewalReminderPreferences {
  if (typeof window === "undefined") return EMPTY_RENEWAL_REMINDER_PREFERENCES;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "null") as Partial<RenewalReminderPreferences> | null;
    return pruneRenewalReminderPreferences(
      {
        dismissedCycles: Array.isArray(parsed?.dismissedCycles)
          ? parsed.dismissedCycles.filter((value): value is string => typeof value === "string")
          : [],
        snoozedUntil:
          parsed?.snoozedUntil && typeof parsed.snoozedUntil === "object"
            ? Object.fromEntries(
                Object.entries(parsed.snoozedUntil)
                  .filter(([key, value]) => key.length > 0 && Number.isFinite(Number(value)))
                  .map(([key, value]) => [key, Number(value)]),
              )
            : {},
      },
      [],
      now,
    );
  } catch {
    return EMPTY_RENEWAL_REMINDER_PREFERENCES;
  }
}

function storePreferences(value: RenewalReminderPreferences) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // 隐私模式或存储配额异常时仍允许本次页面内关闭，持久化失败不打断提醒交互。
  }
}

function AssetLink() {
  return (
    <Link
      to="/assets"
      className="overview-card-action"
      aria-label="打开资产统计页"
      title="资产统计"
    >
      <CircleDollarSign size={15} aria-hidden />
    </Link>
  );
}

export function RenewalReminder({ nodes }: { nodes: RenewalReminderSource[] }) {
  const [open, setOpen] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  const [preferences, setPreferences] = useState(readPreferences);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const panelId = useId();
  const titleId = useId();
  const reminders = useMemo(
    () => getRenewalReminders(nodes, clock, { requireOnlineForExpired: true }),
    [clock, nodes],
  );
  const visibleReminders = useMemo(
    () => getVisibleRenewalReminders(reminders, preferences, clock),
    [clock, preferences, reminders],
  );

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (visibleReminders.length === 0 && open) setOpen(false);
  }, [open, visibleReminders.length]);

  useEffect(() => {
    if (nodes.length === 0) return;
    if (
      preferences.dismissedCycles.length === 0 &&
      Object.keys(preferences.snoozedUntil).length === 0
    ) {
      return;
    }
    const pruned = pruneRenewalReminderPreferences(preferences, nodes, clock);
    if (!equalRenewalPreferences(preferences, pruned)) {
      setPreferences(pruned);
      storePreferences(pruned);
    }
  }, [clock, nodes, preferences]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) setPreferences(readPreferences());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    const now = Date.now();
    let nextWakeAt = now + CLOCK_REFRESH_MS;
    for (const value of Object.values(preferences.snoozedUntil)) {
      if (value > now && value < nextWakeAt) nextWakeAt = value;
    }
    const timeout = window.setTimeout(
      () => setClock(Date.now()),
      Math.max(1_000, nextWakeAt - now + 50),
    );
    return () => window.clearTimeout(timeout);
  }, [clock, preferences.snoozedUntil]);

  const updatePreferences = (next: RenewalReminderPreferences) => {
    const pruned = pruneRenewalReminderPreferences(next, nodes, Date.now());
    setPreferences(pruned);
    storePreferences(pruned);
  };

  const closeAndRestoreFocus = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const snooze = () => {
    const until = Date.now() + RENEWAL_SNOOZE_MS;
    updatePreferences({
      ...preferences,
      snoozedUntil: {
        ...preferences.snoozedUntil,
        ...Object.fromEntries(visibleReminders.map((item) => [item.cycleKey, until])),
      },
    });
    setClock(Date.now());
    closeAndRestoreFocus();
  };

  const dismissCurrentCycles = () => {
    const dismissed = new Set(preferences.dismissedCycles);
    const snoozedUntil = { ...preferences.snoozedUntil };
    for (const item of visibleReminders) {
      dismissed.add(item.cycleKey);
      delete snoozedUntil[item.cycleKey];
    }
    updatePreferences({ dismissedCycles: [...dismissed], snoozedUntil });
    closeAndRestoreFocus();
  };

  if (visibleReminders.length === 0) return <AssetLink />;

  const rows = visibleReminders.slice(0, MAX_VISIBLE_ROWS);
  const hiddenCount = visibleReminders.length - rows.length;
  const expiredCount = visibleReminders.filter((item) => item.daysRemaining < 0).length;
  const upcomingCount = visibleReminders.length - expiredCount;
  const summaryCopy =
    expiredCount > 0 && upcomingCount > 0
      ? `${expiredCount} 台节点已过期，${upcomingCount} 台将在 ${RENEWAL_WARNING_DAYS} 天内到期`
      : expiredCount > 0
        ? `${expiredCount} 台节点已过期，请及时续费`
        : `${visibleReminders.length} 台节点将在 ${RENEWAL_WARNING_DAYS} 天内到期`;
  const moreCopy =
    expiredCount > 0
      ? `还有 ${hiddenCount} 台待续费节点`
      : `还有 ${hiddenCount} 台临期节点`;

  return (
    <div className="renewal-reminder" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="overview-card-action renewal-reminder-trigger"
        aria-label={`${visibleReminders.length} 个续费提醒`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        title={`${visibleReminders.length} 个续费提醒`}
        onClick={() => setOpen((value) => !value)}
      >
        <CircleDollarSign size={15} aria-hidden />
        <span className="renewal-reminder-dot" aria-hidden />
      </button>

      {open && (
        <section
          id={panelId}
          className="renewal-reminder-panel"
          role="dialog"
          aria-labelledby={titleId}
        >
          <header className="renewal-reminder-head">
            <div>
              <div className="renewal-reminder-title-line">
                <h2 id={titleId}>续费提醒</h2>
                <span className="renewal-reminder-count">{visibleReminders.length}</span>
              </div>
              <p>{summaryCopy}</p>
            </div>
            <button
              ref={closeRef}
              type="button"
              className="renewal-reminder-close"
              aria-label="关闭续费提醒"
              title="关闭"
              onClick={closeAndRestoreFocus}
            >
              <X size={15} aria-hidden />
            </button>
          </header>

          <div className="renewal-reminder-list">
            {rows.map((item) => (
              <div className="renewal-reminder-row" key={item.cycleKey}>
                <div className="renewal-reminder-row-main">
                  <strong title={item.name}>{item.name}</strong>
                  <span>{formatRenewalReminderExpiry(item.daysRemaining)}</span>
                  <span>{item.priceLabel}</span>
                </div>
                <span className="renewal-reminder-status" data-tone={item.tone}>
                  {item.statusLabel}
                </span>
              </div>
            ))}
            {hiddenCount > 0 && (
              <p className="renewal-reminder-more">{moreCopy}</p>
            )}
          </div>

          <footer className="renewal-reminder-actions">
            <Link to="/assets" className="renewal-reminder-detail" onClick={() => setOpen(false)}>
              查看详情
            </Link>
            <button type="button" className="renewal-reminder-later" onClick={snooze}>
              {RENEWAL_SNOOZE_DAYS} 天后提醒
            </button>
            <button
              type="button"
              className="renewal-reminder-dismiss"
              onClick={dismissCurrentCycles}
            >
              本周期不再提醒
            </button>
          </footer>
        </section>
      )}
    </div>
  );
}
