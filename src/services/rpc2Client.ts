import { fetchWithTimeout } from "@/utils/abort";

type JsonRpcId = number | string;

interface JsonRpcRequest<TParams = unknown> {
  jsonrpc: "2.0";
  method: string;
  params?: TParams;
  id?: JsonRpcId;
}

interface JsonRpcSuccess<TResult = unknown> {
  jsonrpc?: string;
  id?: JsonRpcId;
  result: TResult;
}

interface JsonRpcFailure {
  jsonrpc?: string;
  id?: JsonRpcId;
  error: {
    code?: number;
    message?: string;
    data?: unknown;
  };
}

type JsonRpcResponse<TResult = unknown> =
  | JsonRpcSuccess<TResult>
  | JsonRpcFailure;

type PendingRequest = {
  resolve: (value: any) => void;
  reject: (reason?: unknown) => void;
  timeout: number;
};

type RpcCallOptions = {
  timeout?: number;
  signal?: AbortSignal;
};

const DEFAULT_TIMEOUT_MS = 30_000;
const HEARTBEAT_INTERVAL_MS = 15_000;
const RECONNECT_INTERVAL_MS = 3_000;
const MAX_RECONNECT_INTERVAL_MS = 30_000;

// 服务端返回的 JSON-RPC 错误*响应*(请求已送达并被处理),区别于传输失败。调用方不能
// 把它再用 HTTP 重试,否则服务端会重复处理同一个请求。
class RpcResponseError extends Error {
  constructor(
    message: string,
    public readonly code?: number,
  ) {
    super(message);
    this.name = "RpcResponseError";
  }
}

class RPC2Client {
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
    if (this.state === "disconnected") {
      this.autoConnect();
    }

    if (this.state === "connected") {
      try {
        return await this.callViaWebSocket<TParams, TResult>(method, params, options);
      } catch (error) {
        // 只在传输失败时兜底到 HTTP。RPC 错误响应意味着服务端已经处理(并拒绝)了这个
        // 请求,用 HTTP 重试会重复处理并掩盖真正的错误。
        if (error instanceof RpcResponseError) throw error;
        return await this.callViaHttp<TParams, TResult>(method, params, options);
      }
    }

    return await this.callViaHttp<TParams, TResult>(method, params, options);
  }

  private autoConnect() {
    if (this.closed) return;
    void this.connect().catch(() => {
      // socket 不可用时仍可走 HTTP 兜底。
    });
  }

  // 清掉所有 timer、socket 和 pending 请求。HMR dispose 时用,避免旧 client 的
  // heartbeat/reconnect 循环和新导入的模块并存运行。
  close() {
    this.closed = true;
    this.stopHeartbeat();
    if (this.reconnectTimer != null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.rejectPendingRequests(new Error("RPC2 client closed"));
    if (this.ws) {
      this.ws.onclose = null;
      try {
        this.ws.close();
      } catch {
        /* noop */
      }
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
        } catch {
          /* noop */
        }
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
        this.state = "connected";
        this.reconnectAttempts = 0;
        this.startHeartbeat();
        resolve();
      };

      const handleError = () => {
        cleanup();
        this.state = "error";
        reject(new Error("RPC2 WebSocket connection failed"));
      };

      // 握手期间的正常关闭(proxy/LB 接受后又断开、WS 层鉴权拒绝)只触发 "close" 不触发
      // "error",没有这个处理 connect promise 会一直挂到 10s 超时 —— 而 scheduleReconnect
      // 下次 connect() 又会拿到这个卡住的 promise,导致恢复停滞。在这里立即 reject 让 promise
      // 结算;常驻的 onclose handler(下面挂的)仍会跑 scheduleReconnect。
      const handleConnectClose = () => {
        cleanup();
        this.state = "error";
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
      try {
        const payload = JSON.parse(String(event.data)) as JsonRpcResponse;
        this.handleMessage(payload);
      } catch {
        // 忽略传输层的非法帧。
      }
    };

    ws.onclose = () => {
      this.stopHeartbeat();
      this.ws = null;
      this.state = "disconnected";
      this.rejectPendingRequests(new Error("RPC2 WebSocket disconnected"));
      this.scheduleReconnect();
    };

    // 不设 onerror:传输错误后必定跟一个 close 事件,onclose 已经负责 state + reconnect。
    //(握手期间由 connect promise 自己的一次性 error listener 负责 reject。)
  }

  private handleMessage(payload: JsonRpcResponse) {
    if (payload.id == null) return;

    const pending = this.pending.get(payload.id);
    if (!pending) return;

    this.pending.delete(payload.id);
    window.clearTimeout(pending.timeout);

    if ("error" in payload) {
      pending.reject(
        new RpcResponseError(
          payload.error.message || `RPC Error ${payload.error.code ?? "unknown"}`,
          payload.error.code,
        ),
      );
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
        reject(new Error(`RPC2 request timed out: ${method}`));
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

      // 包一层 settle:正常响应(在 handleMessage 处理)或传输层 reject 时,也一并摘掉
      // abort listener 和 timer。
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

    const payload = (await response.json()) as JsonRpcResponse<TResult>;
    if ("error" in payload) {
      throw new Error(payload.error.message || `RPC Error ${payload.error.code ?? "unknown"}`);
    }

    return payload.result;
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
      } catch {
        /* noop */
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect() {
    if (this.closed || this.reconnectTimer) return;

    // 指数退避,上限 MAX_RECONNECT_INTERVAL_MS,无限重试。旧代码 5 次后彻底停止,再加上
    // call() 在 disconnected 时 autoConnect,结果要么是无节流的 ~2s 重连风暴,要么完全不
    // 恢复。reconnectAttempts 在成功 open 后归零。
    this.state = "reconnecting";
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
