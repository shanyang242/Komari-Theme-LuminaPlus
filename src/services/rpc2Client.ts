import { fetchWithTimeout } from "@/utils/abort";

type JsonRpcId = number | string;

interface JsonRpcRequest<TParams = unknown> {
  jsonrpc: "2.0";
  method: string;
  params?: TParams;
  id?: JsonRpcId;
}

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  timeout: number;
};

type RpcCallOptions = {
  timeout?: number;
  signal?: AbortSignal;
};

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractRpcError(errorValue: unknown): RpcResponseError {
  if (isJsonRecord(errorValue)) {
    const code = typeof errorValue.code === "number" ? errorValue.code : undefined;
    const message =
      typeof errorValue.message === "string" && errorValue.message.length > 0
        ? errorValue.message
        : `RPC Error ${code ?? "unknown"}`;
    return new RpcResponseError(message, code);
  }
  return new RpcResponseError(String(errorValue || "RPC Error unknown"));
}

const DEFAULT_TIMEOUT_MS = 30_000;
const HEARTBEAT_INTERVAL_MS = 15_000;
const RECONNECT_INTERVAL_MS = 3_000;
const MAX_RECONNECT_INTERVAL_MS = 30_000;

// 服务端 RPC 错误不可再用 HTTP 重试，否则可能重复处理请求。
// 注意:WS 超时(结果未知)也会自动用 HTTP 重放同一调用,因此本客户端只可用于幂等的只读方法。
export class RpcResponseError extends Error {
  constructor(
    message: string,
    public readonly code?: number,
  ) {
    super(message);
    this.name = "RpcResponseError";
  }
}

class RpcWebSocketTimeoutError extends Error {
  constructor(method: string) {
    super(`RPC2 request timed out: ${method}`);
    this.name = "RpcWebSocketTimeoutError";
  }
}

export class RPC2Client {
  private ws: WebSocket | null = null;
  private requestId = 0;
  private pending = new Map<JsonRpcId, PendingRequest>();
  private reconnectAttempts = 0;
  private connectPromise: Promise<void> | null = null;
  private reconnectTimer: number | null = null;
  private heartbeatTimer: number | null = null;
  private closed = false;
  private state: "disconnected" | "connecting" | "connected" | "reconnecting" | "error" =
    "disconnected";

  constructor(private readonly baseUrl = "/api/rpc2") {
    this.autoConnect();
  }

  async call<TParams = Record<string, unknown>, TResult = unknown>(
    method: string,
    params?: TParams,
    options: RpcCallOptions = {},
  ): Promise<TResult> {
    if (this.state === "disconnected" && this.reconnectTimer == null) {
      this.autoConnect();
    }

    const timeoutMs = options.timeout ?? DEFAULT_TIMEOUT_MS;
    if (timeoutMs <= 0) {
      throw new Error(`RPC2 request timed out: ${method}`);
    }
    const deadline = Date.now() + timeoutMs;

    if (this.state === "connected") {
      const socket = this.ws;
      // 为 HTTP 回退预留预算：总预算 > 1ms 时最多分配一半给 WS，避免半开/无响应连接
      // 耗尽全部超时导致无法回退 HTTP，同时保持总耗时仍受调用方 timeout 约束。
      const wsTimeoutMs =
        timeoutMs > 1 ? Math.max(1, Math.floor(timeoutMs / 2)) : timeoutMs;
      try {
        return await this.callViaWebSocket<TParams, TResult>(method, params, {
          ...options,
          timeout: wsTimeoutMs,
        });
      } catch (error) {
        // 服务端已拒绝的 RPC 不能再用 HTTP 重试。
        if (error instanceof RpcResponseError) throw error;
        if (options.signal?.aborted) throw error;
        // WS 请求超时说明当前 OPEN 连接可能已半开/黑洞，关闭失效连接并转入重连退避，
        // 使本次请求剩余预算与后续请求都能避开该失效连接直接走 HTTP 兜底。
        if (error instanceof RpcWebSocketTimeoutError && socket) {
          this.resetUnresponsiveSocket(socket);
        }
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw error;
        return await this.callViaHttp<TParams, TResult>(method, params, {
          ...options,
          timeout: remaining,
        });
      }
    }

    return await this.callViaHttp<TParams, TResult>(method, params, {
      ...options,
      timeout: timeoutMs,
    });
  }

  private autoConnect() {
    if (this.closed || this.reconnectTimer != null) return;
    void this.connect().catch(() => {
      // socket 不可用时仍可走 HTTP 兜底。
    });
  }

  close() {
    this.closed = true;
    this.stopHeartbeat();
    if (this.reconnectTimer != null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.rejectPendingRequests(new Error("RPC2 client closed"));
    if (this.ws) {
      this.ws.onmessage = null;
      this.ws.onclose = null;
      try {
        this.ws.close();
      } catch {}
      this.ws = null;
    }
    this.state = "disconnected";
  }

  private async connect(): Promise<void> {
    if (this.state === "connected") return;
    if (this.connectPromise) return this.connectPromise;

    this.state = this.state === "reconnecting" ? "reconnecting" : "connecting";
    this.connectPromise = new Promise<void>((resolve, reject) => {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const url = `${protocol}//${window.location.host}${this.baseUrl}`;
      const ws = new WebSocket(url);
      this.ws = ws;

      const timeout = window.setTimeout(() => {
        cleanup();
        this.state = "error";
        try {
          ws.close();
        } catch {}
        this.scheduleReconnect();
        reject(new Error("RPC2 WebSocket connection timed out"));
      }, 10_000);

      const cleanup = () => {
        window.clearTimeout(timeout);
        ws.removeEventListener("open", handleOpen);
        ws.removeEventListener("error", handleError);
        ws.removeEventListener("close", handleConnectClose);
      };

      const handleOpen = () => {
        cleanup();
        if (this.closed) {
          this.state = "disconnected";
          try {
            ws.close();
          } catch {}
          reject(new Error("RPC2 client closed during connect"));
          return;
        }
        this.state = "connected";
        this.reconnectAttempts = 0;
        this.startHeartbeat();
        resolve();
      };

      const handleError = () => {
        cleanup();
        if (this.closed) {
          this.state = "disconnected";
          reject(new Error("RPC2 client closed during connect"));
          return;
        }
        this.state = "error";
        this.scheduleReconnect();
        reject(new Error("RPC2 WebSocket connection failed"));
      };

      // 握手关闭可能没有 error 事件，需立即结算 promise 以允许重连。
      const handleConnectClose = () => {
        cleanup();
        if (this.closed) {
          this.state = "disconnected";
          reject(new Error("RPC2 client closed during connect"));
          return;
        }
        this.state = "error";
        this.scheduleReconnect();
        reject(new Error("RPC2 WebSocket closed during connect"));
      };

      ws.addEventListener("open", handleOpen, { once: true });
      ws.addEventListener("error", handleError, { once: true });
      ws.addEventListener("close", handleConnectClose, { once: true });
      this.attachSocketHandlers(ws);
    }).finally(() => {
      this.connectPromise = null;
    });

    return this.connectPromise;
  }

  private attachSocketHandlers(ws: WebSocket) {
    ws.onmessage = (event) => {
      if (this.ws !== ws) return;
      try {
        const payload: unknown = JSON.parse(String(event.data));
        this.handleMessage(payload);
      } catch {
        // 忽略传输层的非法帧。
      }
    };

    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.stopHeartbeat();
      this.ws = null;
      this.state = "disconnected";
      this.rejectPendingRequests(new Error("RPC2 WebSocket disconnected"));
      this.scheduleReconnect();
    };

    // 握手后的传输错误由 close 事件统一处理。
  }

  private handleMessage(payload: unknown) {
    if (!isJsonRecord(payload)) return;
    const id = payload.id;
    if (typeof id !== "number" && typeof id !== "string") return;

    const pending = this.pending.get(id);
    if (!pending) return;

    this.pending.delete(id);
    window.clearTimeout(pending.timeout);

    if (payload.error != null) {
      pending.reject(extractRpcError(payload.error));
      return;
    }

    if (!("result" in payload)) {
      pending.reject(new Error("Invalid RPC2 response: missing result"));
      return;
    }

    pending.resolve(payload.result);
  }

  private async callViaWebSocket<TParams, TResult>(
    method: string,
    params?: TParams,
    options: RpcCallOptions = {},
  ): Promise<TResult> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("RPC2 WebSocket is not connected");
    }

    const { signal } = options;
    if (signal?.aborted) {
      throw signal.reason ?? new DOMException("Aborted", "AbortError");
    }

    const id = ++this.requestId;
    const timeoutMs = options.timeout ?? DEFAULT_TIMEOUT_MS;
    if (timeoutMs <= 0) {
      throw new RpcWebSocketTimeoutError(method);
    }
    const request: JsonRpcRequest<TParams> = {
      jsonrpc: "2.0",
      method,
      params,
      id,
    };

    return await new Promise<TResult>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        cleanup();
        this.pending.delete(id);
        reject(new RpcWebSocketTimeoutError(method));
      }, timeoutMs);

      const onAbort = () => {
        cleanup();
        this.pending.delete(id);
        reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
      };

      const cleanup = () => {
        window.clearTimeout(timeout);
        signal?.removeEventListener("abort", onAbort);
      };

      signal?.addEventListener("abort", onAbort, { once: true });

      this.pending.set(id, {
        resolve: (value) => {
          cleanup();
          resolve(value as TResult);
        },
        reject: (reason) => {
          cleanup();
          reject(reason);
        },
        timeout,
      });

      try {
        this.ws?.send(JSON.stringify(request));
      } catch (error) {
        cleanup();
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  private async callViaHttp<TParams, TResult>(
    method: string,
    params?: TParams,
    options: RpcCallOptions = {},
  ): Promise<TResult> {
    const id = ++this.requestId;
    const timeoutMs = options.timeout ?? DEFAULT_TIMEOUT_MS;
    if (timeoutMs <= 0) {
      throw new Error(`RPC2 request timed out: ${method}`);
    }
    const response = await fetchWithTimeout(
      this.baseUrl,
      {
        method: "POST",
        credentials: "include",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id,
          method,
          params,
        } satisfies JsonRpcRequest<TParams>),
      },
      timeoutMs,
      options.signal,
    );

    if (!response.ok) {
      throw new Error(`Request ${this.baseUrl} failed: ${response.status}`);
    }

    const payload: unknown = await response.json();
    if (!isJsonRecord(payload)) {
      throw new Error("Invalid RPC2 response payload");
    }
    if (payload.error != null) {
      throw extractRpcError(payload.error);
    }
    if (!("result" in payload)) {
      throw new Error("Invalid RPC2 response: missing result");
    }

    return payload.result as TResult;
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = window.setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      try {
        this.ws.send(
          JSON.stringify({
            jsonrpc: "2.0",
            method: "rpc.ping",
            params: { timestamp: Date.now() },
          } satisfies JsonRpcRequest<{ timestamp: number }>),
        );
      } catch {}
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect() {
    if (this.closed) return;
    // 即使定时器已在等待中（例如 handleError 先调度、随后 onclose 覆写 state="disconnected"），
    // 也必须保持 reconnecting，避免轮询 call() 提前触发 autoConnect() 破坏退避。
    this.state = "reconnecting";
    if (this.reconnectTimer != null) return;

    // 指数退避并持续重试，连接成功后归零。
    const delay = Math.min(
      RECONNECT_INTERVAL_MS * 2 ** this.reconnectAttempts,
      MAX_RECONNECT_INTERVAL_MS,
    );
    this.reconnectAttempts += 1;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.autoConnect();
    }, delay);
  }

  private resetUnresponsiveSocket(socket: WebSocket) {
    if (this.ws !== socket) return;
    this.stopHeartbeat();
    socket.onmessage = null;
    socket.onclose = null;
    this.ws = null;
    try {
      socket.close();
    } catch {}
    this.rejectPendingRequests(new Error("RPC2 WebSocket unresponsive"));
    this.scheduleReconnect();
  }

  private rejectPendingRequests(error: Error) {
    for (const [id, pending] of this.pending) {
      window.clearTimeout(pending.timeout);
      pending.reject(error);
      this.pending.delete(id);
    }
  }
}

let rpc2Client: RPC2Client | null = null;

export function getRpc2Client() {
  if (!rpc2Client) {
    rpc2Client = new RPC2Client();
  }
  return rpc2Client;
}

function disposeRpc2Client() {
  if (rpc2Client) {
    rpc2Client.close();
    rpc2Client = null;
  }
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    disposeRpc2Client();
  });
}
