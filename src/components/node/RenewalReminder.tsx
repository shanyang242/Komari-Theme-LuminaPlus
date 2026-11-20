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
  type RenewalReminderPreferences,
  type RenewalReminderSource,
} from "@/utils/renewalReminder";

const STORAGE_KEY = "lumina-renewal-reminders-v1";
const MAX_VISIBLE_ROWS = 4;
const CLOCK_REFRESH_MS = 60 * 60 * 1000;

function readPreferences(): RenewalReminderPreferences {
  if (typeof window === "undefined") return EMPTY_RENEWAL_REMINDER_PREFERENCES;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "null") as Partial<RenewalReminderPreferences> | null;
    return {
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
    };
  } catch {
    return EMPTY_RENEWAL_REMINDER_PREFERENCES;
  }
}

function storePreferences(value: RenewalReminderPreferences) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // 存储失败不阻塞交互
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
    setPreferences(next);
    storePreferences(next);
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
              <p>{visibleReminders.length} 台节点将在 {RENEWAL_WARNING_DAYS} 天内到期</p>
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
              <p className="renewal-reminder-more">还有 {hiddenCount} 台临期节点</p>
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
