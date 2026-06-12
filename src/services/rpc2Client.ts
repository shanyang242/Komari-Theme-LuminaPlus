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
};

const DEFAULT_TIMEOUT_MS = 30_000;
const HEARTBEAT_INTERVAL_MS = 15_000;
const RECONNECT_INTERVAL_MS = 3_000;
const MAX_RECONNECT_INTERVAL_MS = 30_000;

// A JSON-RPC error *response* from the server (the request was delivered and
// processed). This is distinct from a transport failure; callers must not retry
// it over HTTP, which would make the server process the same request twice.
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
        // Only fall back to HTTP on transport failures. An RPC error response
        // means the server already handled (and rejected) this request — retrying
        // it over HTTP would double-process it and mask the real error.
        if (error instanceof RpcResponseError) throw error;
        return await this.callViaHttp<TParams, TResult>(method, params, options);
      }
    }

    return await this.callViaHttp<TParams, TResult>(method, params, options);
  }

  private autoConnect() {
    void this.connect().catch(() => {
      // HTTP fallback remains available even if the socket is unavailable.
    });
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

      ws.addEventListener("open", handleOpen, { once: true });
      ws.addEventListener("error", handleError, { once: true });
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
        // Ignore malformed frames from the transport layer.
      }
    };

    ws.onclose = () => {
      this.stopHeartbeat();
      this.ws = null;
      this.state = "disconnected";
      this.rejectPendingRequests(new Error("RPC2 WebSocket disconnected"));
      this.scheduleReconnect();
    };

    ws.onerror = () => {
      this.state = "error";
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
        this.pending.delete(id);
        reject(new Error(`RPC2 request timed out: ${method}`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timeout });

      try {
        this.ws?.send(JSON.stringify(request));
      } catch (error) {
        window.clearTimeout(timeout);
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
    const response = await fetch(this.baseUrl, {
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
      signal: AbortSignal.timeout(timeoutMs),
    });

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
    if (this.reconnectTimer) return;

    // Exponential backoff capped at MAX_RECONNECT_INTERVAL_MS, retried
    // indefinitely. The previous code stopped permanently after 5 attempts,
    // which (combined with call()'s autoConnect-on-disconnected) produced either
    // an unthrottled ~2s reconnect storm or no recovery at all. reconnectAttempts
    // resets to 0 on a successful open.
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
