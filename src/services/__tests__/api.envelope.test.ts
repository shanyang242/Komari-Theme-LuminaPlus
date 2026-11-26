import { afterEach, describe, expect, it, vi } from "vitest";

const rpcCallMock = vi.hoisted(() => vi.fn());

vi.mock("@/services/rpc2Client", () => ({
  getRpc2Client: () => ({ call: rpcCallMock }),
}));

import { getPublic, saveThemeSettings } from "@/services/api";

describe("API envelope parsing", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    rpcCallMock.mockReset();
  });

  it("preserves a server error message when an error envelope omits data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ status: "error", message: "theme unavailable" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    await expect(getPublic()).rejects.toMatchObject({
      name: "ApiRequestError",
      message: "theme unavailable",
      status: 200,
      path: "/api/public",
    });
  });

  it("still validates successful envelope data with the endpoint schema", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            status: "success",
            data: { sitename: "Test site", theme_settings: { showPingChart: false } },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    const result = await getPublic();
    expect(result.sitename).toBe("Test site");
    expect(result.theme_settings).toEqual({ showPingChart: false });
  });

  it("rejects saveThemeSettings when HTTP 200 body reports status=error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ status: "error", message: "permission denied" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    await expect(saveThemeSettings("LuminaPlus", { showRegionBar: false })).rejects.toMatchObject({
      name: "ApiRequestError",
      message: "permission denied",
      status: 200,
    });
  });
});
