import { describe, expect, it } from "vitest";
import type { RenewalReminderSource } from "@/utils/renewalReminder";
import {
  getRenewalReminders,
  getVisibleRenewalReminders,
  RENEWAL_SNOOZE_MS,
  renewalCycleKey,
} from "@/utils/renewalReminder";
import { getExpireDaysRemaining } from "@/utils/format";
import { pruneRenewalReminderPreferences } from "@/components/node/RenewalReminder";

const DAY_MS = 86_400_000;
const NOW = Date.UTC(2026, 6, 12, 0, 0, 0);

function inDays(days: number) {
  return new Date(NOW + days * DAY_MS).toISOString();
}

function node(overrides: Partial<RenewalReminderSource> = {}): RenewalReminderSource {
  return {
    uuid: "node-1",
    name: "Tokyo Edge",
    weight: 1,
    price: 12,
    currency: "$",
    billing_cycle: "month",
    auto_renewal: false,
    expired_at: inDays(7),
    ...overrides,
  };
}

describe("renewal reminders", () => {
  it("keeps only nodes due within 7 days and sorts the most urgent first", () => {
    const reminders = getRenewalReminders(
      [
        node({ uuid: "later", name: "Later", expired_at: inDays(8) }),
        node({ uuid: "soon", name: "Soon", expired_at: inDays(7), auto_renewal: true }),
        node({ uuid: "urgent", name: "Urgent", expired_at: inDays(3) }),
        node({ uuid: "none", name: "No expiry", expired_at: "" }),
      ],
      NOW,
    );

    expect(reminders.map((item) => item.uuid)).toEqual(["urgent", "soon"]);
    expect(reminders[0]).toMatchObject({
      daysRemaining: 3,
      tone: "critical",
      statusLabel: "即将到期",
    });
    expect(reminders[1]).toMatchObject({
      daysRemaining: 7,
      tone: "success",
      statusLabel: "自动续费已开启",
    });
  });

  it("keeps expired reminders only for nodes confirmed online", () => {
    const reminders = getRenewalReminders(
      [
        node({ uuid: "offline-expired", expired_at: inDays(-2), online: false }),
        node({ uuid: "online-expired", expired_at: inDays(-2), online: true }),
        node({ uuid: "unknown-expired", expired_at: inDays(-2), online: null }),
        node({ uuid: "offline-soon", expired_at: inDays(3), online: false }),
      ],
      NOW,
      { requireOnlineForExpired: true },
    );
    const reminderByUuid = new Map(reminders.map((item) => [item.uuid, item]));

    expect(reminderByUuid.has("offline-expired")).toBe(false);
    expect(reminderByUuid.get("online-expired")?.statusLabel).toBe("已过期");
    expect(reminderByUuid.has("unknown-expired")).toBe(false);
    expect(reminderByUuid.get("offline-soon")?.statusLabel).toBe("即将到期");
  });

  it("keeps expired entries in the asset risk view without the online gate", () => {
    const reminders = getRenewalReminders(
      [
        node({ uuid: "offline-expired", expired_at: inDays(-2), online: false }),
        node({ uuid: "unknown-expired", expired_at: inDays(-2), online: null }),
      ],
      NOW,
    );

    expect(reminders.map((item) => item.uuid)).toEqual(["offline-expired", "unknown-expired"]);
  });

  it("snoozes reminders for exactly one day", () => {
    expect(RENEWAL_SNOOZE_MS).toBe(DAY_MS);
  });

  it("uses the same whole-day rounding as cards and the assets page", () => {
    const expiresAt = NOW + 3 * DAY_MS - 1;
    const [reminder] = getRenewalReminders(
      [node({ expired_at: new Date(expiresAt).toISOString() })],
      NOW,
    );
    expect(reminder.daysRemaining).toBe(2);
    expect(reminder.daysRemaining).toBe(getExpireDaysRemaining(expiresAt, NOW));
  });

  it("binds dismissal to the exact expiry cycle", () => {
    const current = node({ expired_at: inDays(3) });
    const renewed = node({ expired_at: inDays(33) });

    expect(renewalCycleKey(current)).not.toBe(renewalCycleKey(renewed));
  });

  it("hides dismissed and currently snoozed cycles, then restores expired snoozes", () => {
    const reminders = getRenewalReminders(
      [node({ uuid: "dismiss" }), node({ uuid: "snooze" }), node({ uuid: "visible" })],
      NOW,
    );
    const key = (uuid: string) => reminders.find((item) => item.uuid === uuid)!.cycleKey;
    const preferences = {
      dismissedCycles: [key("dismiss")],
      snoozedUntil: { [key("snooze")]: NOW + DAY_MS },
    };

    expect(getVisibleRenewalReminders(reminders, preferences, NOW).map((item) => item.uuid)).toEqual([
      "visible",
    ]);
    expect(
      getVisibleRenewalReminders(reminders, preferences, NOW + 2 * DAY_MS).map((item) => item.uuid),
    ).toEqual(["snooze", "visible"]);
  });

  it("prunes expired snoozes and obsolete dismissed cycles while preserving active offline expired cycles", () => {
    const activeUpcoming = node({ uuid: "node-renewed", expired_at: inDays(30) });
    const offlineExpired = node({ uuid: "node-expired", expired_at: inDays(-3), online: false });
    const activeKey = renewalCycleKey(activeUpcoming)!;
    const oldRenewedKey = renewalCycleKey(node({ uuid: "node-renewed", expired_at: inDays(1) }))!;
    const offlineExpiredKey = renewalCycleKey(offlineExpired)!;
    const deletedOldKey = `node-deleted:${NOW - 5 * DAY_MS}`;

    const pruned = pruneRenewalReminderPreferences(
      {
        dismissedCycles: [oldRenewedKey, activeKey, offlineExpiredKey, deletedOldKey, "malformed"],
        snoozedUntil: {
          [activeKey]: NOW + DAY_MS,
          [oldRenewedKey]: NOW + DAY_MS,
          [offlineExpiredKey]: NOW - 1_000,
        },
      },
      [activeUpcoming, offlineExpired],
      NOW,
    );

    expect(pruned).toEqual({
      dismissedCycles: [activeKey, offlineExpiredKey],
      snoozedUntil: { [activeKey]: NOW + DAY_MS },
    });
  });

  it("keeps dismissed cycles older than 30 days until nodes load so page refresh does not resurface them", () => {
    const expired31d = node({ uuid: "node-31d", expired_at: inDays(-31), online: true });
    const expired31dKey = renewalCycleKey(expired31d)!;
    const deleted31dKey = `node-deleted:${NOW - 31 * DAY_MS}`;

    // 刷新页面瞬间节点列表尚未加载（nodes 为空）：不得按 30 天误删仍有效的忽略记录
    const beforeNodesLoaded = pruneRenewalReminderPreferences(
      {
        dismissedCycles: [expired31dKey, deleted31dKey, "malformed"],
        snoozedUntil: {
          [expired31dKey]: NOW - 1_000,
        },
      },
      [],
      NOW,
    );
    expect(beforeNodesLoaded).toEqual({
      dismissedCycles: [expired31dKey, deleted31dKey],
      snoozedUntil: {},
    });

    // 节点列表加载后：仍在且到期日未变的 31 天过期在线节点保持忽略，已删除节点记录被清理
    const afterNodesLoaded = pruneRenewalReminderPreferences(
      beforeNodesLoaded,
      [expired31d],
      NOW,
    );
    expect(afterNodesLoaded).toEqual({
      dismissedCycles: [expired31dKey],
      snoozedUntil: {},
    });

    const reminders = getRenewalReminders([expired31d], NOW, { requireOnlineForExpired: true });
    expect(reminders).toHaveLength(1);
    expect(getVisibleRenewalReminders(reminders, afterNodesLoaded, NOW)).toEqual([]);
  });
});
