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
  resolve: (value: unknown) => void;
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

// 服务端 RPC 错误不走 HTTP 重试；WS 超时会回退 HTTP 重放，仅用于幂等只读调用
class RpcResponseError extends Error {
  constructor(
    message: string,
    public readonly code?: number,
  ) {
    super(message);
    this.name = "RpcResponseError";
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
    if (this.state === "disconnected") {
      this.autoConnect();
    }

    if (this.state === "connected") {
      try {
        return await this.callViaWebSocket<TParams, TResult>(method, params, options);
      } catch (error) {
        if (error instanceof RpcResponseError) throw error;
        if (options.signal?.aborted) throw error;
        return await this.callViaHttp<TParams, TResult>(method, params, options);
      }
    }

    return await this.callViaHttp<TParams, TResult>(method, params, options);
  }

  private autoConnect() {
    if (this.closed) return;
    void this.connect().catch(() => {
      // 失败时由 HTTP 兜底
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
        if (this.ws === ws) this.ws = null;
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
          if (this.ws === ws) this.ws = null;
          this.state = "disconnected";
          try {
            ws.close();
          } catch {}
          reject(new Error("RPC2 client closed during connect"));
          return;
        }
        this.state = "connected";
        this.reconnectAttempts = 0;
        this.attachSocketHandlers(ws);
        this.startHeartbeat();
        resolve();
      };

      const handleError = () => {
        cleanup();
        if (this.ws === ws) this.ws = null;
        this.state = "error";
        try {
          ws.close();
        } catch {}
        this.scheduleReconnect();
        reject(new Error("RPC2 WebSocket connection failed"));
      };

      // 握手关闭可能无 error 事件，需在此结算并重连
      const handleConnectClose = () => {
        cleanup();
        if (this.ws === ws) this.ws = null;
        this.state = "error";
        this.scheduleReconnect();
        reject(new Error("RPC2 WebSocket closed during connect"));
      };

      ws.addEventListener("open", handleOpen, { once: true });
      ws.addEventListener("error", handleError, { once: true });
      ws.addEventListener("close", handleConnectClose, { once: true });
    }).finally(() => {
      this.connectPromise = null;
    });

    return this.connectPromise;
  }

  private attachSocketHandlers(ws: WebSocket) {
    ws.onmessage = (event) => {
      if (this.ws !== ws) return;
      try {
        const payload = JSON.parse(String(event.data)) as JsonRpcResponse;
        this.handleMessage(payload);
      } catch {
        // 忽略非法帧
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
      throw new RpcResponseError(
        payload.error.message || `RPC Error ${payload.error.code ?? "unknown"}`,
        payload.error.code,
      );
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
    if (this.closed || this.reconnectTimer) return;

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
