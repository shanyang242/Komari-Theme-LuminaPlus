import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RPC2Client, RpcResponseError } from "@/services/rpc2Client";

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readyState = MockWebSocket.CONNECTING;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  sent: string[] = [];
  private listeners = new Map<string, Array<() => void>>();

  constructor(public readonly url: string) {
    MockWebSocket.instances.push(this);
  }

  addEventListener(type: string, fn: () => void) {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }

  removeEventListener(type: string, fn: () => void) {
    const list = this.listeners.get(type);
    if (!list) return;
    this.listeners.set(
      type,
      list.filter((item) => item !== fn),
    );
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
  }

  emitOpen() {
    this.readyState = MockWebSocket.OPEN;
    for (const fn of [...(this.listeners.get("open") ?? [])]) fn();
  }

  emitError() {
    for (const fn of [...(this.listeners.get("error") ?? [])]) fn();
  }

  emitClose() {
    this.readyState = MockWebSocket.CLOSED;
    for (const fn of [...(this.listeners.get("close") ?? [])]) fn();
    this.onclose?.();
  }

  emitMessage(raw: string) {
    this.onmessage?.({ data: raw });
  }
}

describe("RPC2Client", () => {
  const originalWindow = globalThis.window;
  const originalWebSocket = globalThis.WebSocket;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
    MockWebSocket.instances = [];
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        location: { protocol: "https:", host: "example.com" },
        setTimeout: globalThis.setTimeout.bind(globalThis),
        clearTimeout: globalThis.clearTimeout.bind(globalThis),
        setInterval: globalThis.setInterval.bind(globalThis),
        clearInterval: globalThis.clearInterval.bind(globalThis),
      },
    });
    Object.defineProperty(globalThis, "WebSocket", {
      configurable: true,
      value: MockWebSocket,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
    Object.defineProperty(globalThis, "WebSocket", {
      configurable: true,
      value: originalWebSocket,
    });
    globalThis.fetch = originalFetch;
  });

  it("handles primitive frames and resolves/rejects { error: null } WS responses without hanging", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id: 2, result: { via: "http" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const client = new RPC2Client();
    const ws = MockWebSocket.instances[0]!;
    ws.emitOpen();

    // 非法原始值帧不得抛错或影响后续请求
    ws.emitMessage("null");
    ws.emitMessage("123");
    ws.emitMessage('"hello"');
    ws.emitMessage("[1,2,3]");

    // { id, error: null, result } 视为成功响应
    const p1 = client.call("common:getNodes");
    const req1 = JSON.parse(ws.sent[0]!) as { id: number };
    ws.emitMessage(JSON.stringify({ jsonrpc: "2.0", id: req1.id, error: null, result: { ok: 1 } }));
    await expect(p1).resolves.toEqual({ ok: 1 });

    // { id, error: null } 缺少 result 时必须立刻结束（回退 HTTP），不得永久 pending
    const p2 = client.call("common:getNodes");
    const req2 = JSON.parse(ws.sent[1]!) as { id: number };
    ws.emitMessage(JSON.stringify({ jsonrpc: "2.0", id: req2.id, error: null }));
    await expect(p2).resolves.toEqual({ via: "http" });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // 真正的 RPC error 不得回退 HTTP
    const p3 = client.call("common:getNodes");
    const req3 = JSON.parse(ws.sent[2]!) as { id: number };
    ws.emitMessage(
      JSON.stringify({ jsonrpc: "2.0", id: req3.id, error: { code: -32601, message: "not found" } }),
    );
    await expect(p3).rejects.toBeInstanceOf(RpcResponseError);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    client.close();
  });

  it("rejects malformed HTTP responses cleanly and supports { error: null, result }", async () => {
    const client = new RPC2Client();

    globalThis.fetch = vi.fn(async () => new Response("null", { status: 200 })) as typeof fetch;
    await expect(client.call("common:getNodes")).rejects.toThrow("Invalid RPC2 response payload");

    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ id: 1, error: null, result: 42 }), { status: 200 }),
    ) as typeof fetch;
    await expect(client.call("common:getNodes")).resolves.toBe(42);

    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ id: 1, error: "plain error" }), { status: 200 }),
    ) as typeof fetch;
    await expect(client.call("common:getNodes")).rejects.toThrow("plain error");

    client.close();
  });

  it("preserves exponential backoff after error+close so polling call() does not reconnect early", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "ok" }), { status: 200 }),
    ) as typeof fetch;

    const client = new RPC2Client();
    expect(MockWebSocket.instances).toHaveLength(1);

    // 握手失败：先触发 error（调度 3s 退避），再触发 close
    MockWebSocket.instances[0]!.emitError();
    MockWebSocket.instances[0]!.emitClose();

    // 退避期间轮询 call() 应走 HTTP 且不提前创建新 WebSocket
    await expect(client.call("common:getNodes")).resolves.toBe("ok");
    expect(MockWebSocket.instances).toHaveLength(1);

    vi.advanceTimersByTime(2_999);
    expect(MockWebSocket.instances).toHaveLength(1);

    vi.advanceTimersByTime(1);
    expect(MockWebSocket.instances).toHaveLength(2);

    client.close();
  });

  it("uses an independent health probe before closing a silent socket and bypasses it while probing", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "from-http" }), {
        status: 200,
      }),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const client = new RPC2Client();
    const ws = MockWebSocket.instances[0]!;
    ws.emitOpen();

    // 单次请求超时只触发独立探测，当前请求仍按原预算回退 HTTP。
    const first = client.call("common:getNodes", {}, { timeout: 2_000 });
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(first).resolves.toBe("from-http");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(ws.readyState).toBe(MockWebSocket.OPEN);
    expect(JSON.parse(ws.sent[1]!).method).toBe("rpc.ping");

    // 探测期间的新调用直接走 HTTP，已有连接尚未被关闭。
    const second = client.call("common:getNodes", {}, { timeout: 2_000 });
    await expect(second).resolves.toBe("from-http");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(MockWebSocket.instances).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(9_999);
    expect(ws.readyState).toBe(MockWebSocket.OPEN);
    await vi.advanceTimersByTimeAsync(1);
    expect(ws.readyState).toBe(MockWebSocket.CLOSED);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(MockWebSocket.instances).toHaveLength(2);

    client.close();
  });

  it("preserves a concurrent long-budget WS request when a 500ms call times out after 250ms", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ result: "http" })));
    globalThis.fetch = fetchMock as typeof fetch;
    const client = new RPC2Client();
    const ws = MockWebSocket.instances[0]!;
    ws.emitOpen();
    const normal = client.call("normal", {}, { timeout: 8_000 });
    const normalId = JSON.parse(ws.sent[0]!).id;
    const short = client.call("short", {}, { timeout: 500 });

    await vi.advanceTimersByTimeAsync(250);
    await expect(short).resolves.toBe("http");
    expect(ws.readyState).toBe(MockWebSocket.OPEN);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    ws.emitMessage(JSON.stringify({ id: normalId, result: "ws" }));
    await expect(normal).resolves.toBe("ws");

    const probeId = JSON.parse(ws.sent[2]!).id;
    ws.emitMessage(JSON.stringify({ id: probeId, result: "pong" }));
    await vi.advanceTimersByTimeAsync(0);
    const next = client.call("next");
    const nextId = JSON.parse(ws.sent[3]!).id;
    ws.emitMessage(JSON.stringify({ id: nextId, result: "still-ws" }));
    await expect(next).resolves.toBe("still-ws");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(ws.readyState).toBe(MockWebSocket.OPEN);
    client.close();
  });

  it("treats an RPC error from the health probe as evidence that the socket is responsive", async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ result: "http" }))) as typeof fetch;
    const client = new RPC2Client();
    const ws = MockWebSocket.instances[0]!;
    ws.emitOpen();
    const request = client.call("short", {}, { timeout: 500 });
    await vi.advanceTimersByTimeAsync(250);
    await request;
    const probeId = JSON.parse(ws.sent[1]!).id;
    ws.emitMessage(JSON.stringify({ id: probeId, error: { code: -32601, message: "not found" } }));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(ws.readyState).toBe(MockWebSocket.OPEN);
    client.close();
  });

  it("caps combined WebSocket + HTTP fallback timeout to the caller budget when both hang", async () => {
    const fetchMock = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(init.signal?.reason ?? new DOMException("Aborted", "AbortError"));
          });
        }),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const client = new RPC2Client();
    const ws = MockWebSocket.instances[0]!;
    ws.emitOpen();

    const pending = client.call("common:getNodes", {}, { timeout: 2_000 });
    let settled = false;
    const assertion = pending.catch((err) => {
      settled = true;
      return err;
    });

    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1_000);
    const error = await assertion;
    expect(settled).toBe(true);
    expect(error).toBeInstanceOf(Error);

    client.close();
  });

  it("fails fast on non-positive timeout without tearing down a healthy OPEN socket", async () => {
    const client = new RPC2Client();
    const ws = MockWebSocket.instances[0]!;
    ws.emitOpen();

    await expect(client.call("common:getNodes", {}, { timeout: 0 })).rejects.toThrow(
      "RPC2 request timed out",
    );
    expect(ws.readyState).toBe(MockWebSocket.OPEN);

    client.close();
  });

  it("does not schedule reconnect if closed while WebSocket is still connecting", () => {
    const client = new RPC2Client();
    expect(MockWebSocket.instances).toHaveLength(1);

    client.close();
    MockWebSocket.instances[0]!.emitClose();
    vi.advanceTimersByTime(60_000);
    expect(MockWebSocket.instances).toHaveLength(1);
  });
});
