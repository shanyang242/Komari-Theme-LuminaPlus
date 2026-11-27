import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWithTimeout, waitForSharedRequest, withTimeoutSignal } from "@/utils/abort";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("waitForSharedRequest", () => {
  it("does not start a request for an already cancelled or exhausted caller", async () => {
    const start = vi.fn(() => Promise.reject(new Error("must not start")));
    const controller = new AbortController();
    controller.abort();
    await expect(waitForSharedRequest(start, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    await expect(waitForSharedRequest(start, undefined, 0)).rejects.toMatchObject({ name: "TimeoutError" });
    await expect(waitForSharedRequest(start, undefined, -1)).rejects.toMatchObject({ name: "TimeoutError" });
    expect(start).not.toHaveBeenCalled();
  });

  it("cancels one waiter without cancelling a shared request needed by another", async () => {
    let resolve!: (value: number) => void;
    const shared = new Promise<number>((done) => { resolve = done; });
    const controller = new AbortController();
    const cancelled = waitForSharedRequest(() => shared, controller.signal);
    const other = waitForSharedRequest(() => shared);
    const assertion = expect(cancelled).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await assertion;
    resolve(42);
    await expect(other).resolves.toBe(42);
  });

  it("consumes a late shared rejection after the caller has timed out", async () => {
    vi.useFakeTimers();
    let reject!: (error: Error) => void;
    const shared = new Promise<never>((_done, fail) => { reject = fail; });
    const waiting = waitForSharedRequest(() => shared, undefined, 50);
    const assertion = expect(waiting).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.advanceTimersByTimeAsync(50);
    await assertion;
    reject(new Error("late shared failure"));
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("fetchWithTimeout", () => {
  it("clears the timeout the moment the request settles", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true }) as Response));

    await fetchWithTimeout("/x", undefined, 10_000);

    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears the timeout even when the request rejects", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("network down");
    }));

    await expect(fetchWithTimeout("/x", undefined, 10_000)).rejects.toThrow("network down");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("passes an unaborted combined signal to fetch", async () => {
    let seen: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: unknown, init?: RequestInit) => {
        seen = init?.signal ?? undefined;
        return { ok: true } as Response;
      }),
    );

    await fetchWithTimeout("/x", undefined, 10_000);
    expect(seen).toBeInstanceOf(AbortSignal);
    expect(seen?.aborted).toBe(false);
  });

  it("propagates an already-aborted upstream signal to fetch", async () => {
    const upstream = new AbortController();
    upstream.abort();
    let seen: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: unknown, init?: RequestInit) => {
        seen = init?.signal ?? undefined;
        return { ok: true } as Response;
      }),
    );

    await fetchWithTimeout("/x", undefined, 10_000, upstream.signal);
    expect(seen?.aborted).toBe(true);
  });

  it("preserves the signal supplied through RequestInit", async () => {
    const request = new AbortController();
    let seen: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: unknown, init?: RequestInit) => {
        seen = init?.signal ?? undefined;
        return { ok: true } as Response;
      }),
    );

    request.abort("cancelled");
    await fetchWithTimeout("/x", { signal: request.signal }, 10_000);
    expect(seen?.aborted).toBe(true);
    expect(seen?.reason).toBe("cancelled");
  });

  it("combines explicit and RequestInit cancellation sources", async () => {
    const explicit = new AbortController();
    const request = new AbortController();
    let seen: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: unknown, init?: RequestInit) => {
        seen = init?.signal ?? undefined;
        return { ok: true } as Response;
      }),
    );

    explicit.abort("explicit");
    await fetchWithTimeout("/x", { signal: request.signal }, 10_000, explicit.signal);
    expect(seen?.aborted).toBe(true);
    expect(seen?.reason).toBe("explicit");
  });

  it("preserves cancellation from a Request input", async () => {
    const requestController = new AbortController();
    const request = new Request("https://example.test/x", {
      signal: requestController.signal,
    });
    let seen: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: unknown, init?: RequestInit) => {
        seen = init?.signal ?? undefined;
        return { ok: true } as Response;
      }),
    );

    requestController.abort("request");
    await fetchWithTimeout(request, undefined, 10_000);
    expect(seen?.aborted).toBe(true);
    expect(seen?.reason).toBe("request");
  });

  it("lets RequestInit.signal override the signal on a Request input", async () => {
    const requestController = new AbortController();
    const initController = new AbortController();
    const request = new Request("https://example.test/x", {
      signal: requestController.signal,
    });
    requestController.abort("request");
    let seen: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: unknown, init?: RequestInit) => {
        seen = init?.signal ?? undefined;
        return { ok: true } as Response;
      }),
    );

    await fetchWithTimeout(request, { signal: initController.signal }, 10_000);
    expect(seen?.aborted).toBe(false);
  });
});

describe("withTimeoutSignal", () => {
  it("cleans its timer as soon as the operation settles", async () => {
    vi.useFakeTimers();

    await expect(
      withTimeoutSignal(async (signal) => {
        expect(signal.aborted).toBe(false);
        return "ok";
      }, 5_000),
    ).resolves.toBe("ok");

    expect(vi.getTimerCount()).toBe(0);
  });

  it("removes the upstream listener after an early rejection", async () => {
    vi.useFakeTimers();
    const upstream = new AbortController();
    const removeEventListener = vi.spyOn(upstream.signal, "removeEventListener");

    await expect(
      withTimeoutSignal(
        async () => {
          throw new Error("failed early");
        },
        5_000,
        upstream.signal,
      ),
    ).rejects.toThrow("failed early");

    expect(removeEventListener).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });
});
