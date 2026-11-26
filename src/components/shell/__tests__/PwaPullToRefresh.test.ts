import { describe, expect, it, vi } from "vitest";
import {
  attachPwaPullToRefresh,
  isIosStandalone,
  type PullState,
} from "@/components/shell/PwaPullToRefresh";

function createTouchHarness(initialOnline = true) {
  const listeners = new Map<string, Set<EventListener>>();
  const timers = new Map<number, () => void>();
  let nextTimerId = 1;
  const states: PullState[] = [];
  const distances: number[] = [];
  let reloads = 0;

  const doc = {
    addEventListener(type: string, fn: EventListenerOrEventListenerObject) {
      const set = listeners.get(type) ?? new Set();
      set.add(fn as EventListener);
      listeners.set(type, set);
    },
    removeEventListener(type: string, fn: EventListenerOrEventListenerObject) {
      listeners.get(type)?.delete(fn as EventListener);
    },
  } as unknown as Pick<Document, "addEventListener" | "removeEventListener">;

  const win = {
    scrollY: 0,
    setTimeout(fn: () => void) {
      const id = nextTimerId++;
      timers.set(id, fn);
      return id;
    },
    clearTimeout(id: number) {
      timers.delete(id);
    },
  } as unknown as Pick<Window, "scrollY" | "setTimeout" | "clearTimeout">;

  const nav = { onLine: initialOnline };

  const emit = (type: string, touches: Array<{ clientX: number; clientY: number }>) => {
    const event = {
      touches,
      target: null,
      cancelable: true,
      preventDefault: vi.fn(),
    } as unknown as Event;
    for (const fn of [...(listeners.get(type) ?? [])]) {
      fn(event);
    }
  };

  const attach = () =>
    attachPwaPullToRefresh({
      doc,
      win,
      nav,
      onStateChange: (state) => states.push(state),
      onDistanceChange: (distance) => distances.push(distance),
      onReload: () => {
        reloads += 1;
      },
    });

  return {
    attach,
    emit,
    nav,
    timers,
    states,
    distances,
    getReloads: () => reloads,
  };
}

describe("iOS PWA detection", () => {
  it("enables pull-to-refresh for installed iPhone and iPad apps", () => {
    expect(isIosStandalone("Mozilla/5.0 (iPhone)", "iPhone", 5, true, false)).toBe(true);
    expect(isIosStandalone("Mozilla/5.0 (Macintosh)", "MacIntel", 5, false, true)).toBe(true);
  });

  it("does not change normal Safari, Android PWA, or desktop behavior", () => {
    expect(isIosStandalone("Mozilla/5.0 (iPhone)", "iPhone", 5, false, false)).toBe(false);
    expect(isIosStandalone("Mozilla/5.0 (Linux; Android 15)", "Linux armv8l", 5, true, true)).toBe(false);
    expect(isIosStandalone("Mozilla/5.0 (Macintosh)", "MacIntel", 0, true, true)).toBe(false);
  });
});

describe("attachPwaPullToRefresh lifecycle and multi-touch safety", () => {
  it("resets refreshing/offline/ready states on cleanup so re-enabling cannot lock or accidentally reload", () => {
    const harness = createTouchHarness(true);
    let detach = harness.attach();

    // 拉至 ready 态后清理，再重新挂载并触发一次 touchend，不得误刷新
    harness.emit("touchstart", [{ clientX: 50, clientY: 10 }]);
    harness.emit("touchmove", [{ clientX: 50, clientY: 120 }]);
    expect(harness.states.at(-1)).toBe("ready");
    detach();
    expect(harness.states.at(-1)).toBe("idle");

    detach = harness.attach();
    harness.emit("touchend", []);
    expect(harness.getReloads()).toBe(0);

    // 进入 refreshing 态后立即清理，定时器被清除且状态回 idle，重新挂载后仍可正常下拉
    harness.emit("touchstart", [{ clientX: 50, clientY: 10 }]);
    harness.emit("touchmove", [{ clientX: 50, clientY: 120 }]);
    harness.emit("touchend", []);
    expect(harness.states.at(-1)).toBe("refreshing");
    expect(harness.timers.size).toBe(1);
    detach();
    expect(harness.timers.size).toBe(0);
    expect(harness.states.at(-1)).toBe("idle");

    detach = harness.attach();
    harness.emit("touchstart", [{ clientX: 50, clientY: 10 }]);
    harness.emit("touchmove", [{ clientX: 50, clientY: 120 }]);
    expect(harness.states.at(-1)).toBe("ready");
    detach();

    // 离线态 cleanup 同样重置
    harness.nav.onLine = false;
    detach = harness.attach();
    harness.emit("touchstart", [{ clientX: 50, clientY: 10 }]);
    harness.emit("touchmove", [{ clientX: 50, clientY: 120 }]);
    harness.emit("touchend", []);
    expect(harness.states.at(-1)).toBe("offline");
    detach();
    expect(harness.states.at(-1)).toBe("idle");
    expect(harness.timers.size).toBe(0);
  });

  it("cancels tracking when a second finger touches down so pinch-zoom never triggers reload", () => {
    const harness = createTouchHarness(true);
    const detach = harness.attach();

    harness.emit("touchstart", [{ clientX: 50, clientY: 10 }]);
    harness.emit("touchmove", [{ clientX: 50, clientY: 120 }]);
    expect(harness.states.at(-1)).toBe("ready");

    // 第二指按下开始缩放
    harness.emit("touchstart", [
      { clientX: 50, clientY: 120 },
      { clientX: 120, clientY: 140 },
    ]);
    expect(harness.states.at(-1)).toBe("idle");

    // 抬指不得触发刷新
    harness.emit("touchend", [{ clientX: 120, clientY: 140 }]);
    harness.emit("touchend", []);
    expect(harness.getReloads()).toBe(0);
    expect(harness.timers.size).toBe(0);
    detach();
  });
});
