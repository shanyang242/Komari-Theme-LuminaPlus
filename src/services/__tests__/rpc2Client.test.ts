import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RPC2Client } from "@/services/rpc2Client";

class FakeWebSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;

  constructor(public readonly url: string) {
    super();
    FakeWebSocket.instances.push(this);
  }

  send = vi.fn();

  close() {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    queueMicrotask(() => {
      const event = new Event("close") as CloseEvent;
      this.dispatchEvent(event);
      this.onclose?.(event);
    });
  }

  emitOpen() {
    this.readyState = FakeWebSocket.OPEN;
    this.dispatchEvent(new Event("open"));
  }

  emitErrorThenClose() {
    this.dispatchEvent(new Event("error"));
    this.readyState = FakeWebSocket.CLOSED;
    const closeEvent = new Event("close") as CloseEvent;
    this.dispatchEvent(closeEvent);
    this.onclose?.(closeEvent);
  }
}

describe("RPC2Client handshake & reconnect backoff", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeWebSocket.instances = [];
    vi.stubGlobal("window", {
      location: { protocol: "http:", host: "localhost:5173" },
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
      setInterval: globalThis.setInterval.bind(globalThis),
      clearInterval: globalThis.clearInterval.bind(globalThis),
    });
    vi.stubGlobal("WebSocket", FakeWebSocket);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ jsonrpc: "2.0", id: 1, result: { ok: true } }),
      })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("preserves exponential backoff when handshake fails and does not reconnect on every call()", async () => {
    const client = new RPC2Client("/api/rpc2");
    expect(FakeWebSocket.instances).toHaveLength(1);

    FakeWebSocket.instances[0].emitErrorThenClose();
    await Promise.resolve();

    await client.call("common:getNodes");
    expect(FakeWebSocket.instances).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(2_999);
    expect(FakeWebSocket.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeWebSocket.instances).toHaveLength(2);

    FakeWebSocket.instances[1].emitErrorThenClose();
    await Promise.resolve();

    await vi.advanceTimersByTimeAsync(5_999);
    expect(FakeWebSocket.instances).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeWebSocket.instances).toHaveLength(3);

    client.close();
  });

  it("schedules reconnect cleanly after handshake timeout", async () => {
    const client = new RPC2Client("/api/rpc2");
    expect(FakeWebSocket.instances).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(FakeWebSocket.instances).toHaveLength(1);

    await client.call("common:getNodes");
    expect(FakeWebSocket.instances).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(3_000);
    expect(FakeWebSocket.instances).toHaveLength(2);

    FakeWebSocket.instances[1].emitOpen();
    client.close();
  });
});
