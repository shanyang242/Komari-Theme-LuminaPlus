import { describe, expect, it, vi } from "vitest";
import {
  getAdminDestination,
  isAdminPath,
  isKomariRootServiceWorker,
  repairKomariServiceWorker,
} from "@/utils/komariServiceWorker";

function registration(
  scope: string,
  scriptURL: string,
): Pick<
  ServiceWorkerRegistration,
  "scope" | "active" | "waiting" | "installing"
> {
  return {
    scope,
    active: { scriptURL } as ServiceWorker,
    waiting: null,
    installing: null,
  };
}

describe("Komari service worker recovery", () => {
  it("matches only the root-scoped Komari worker", () => {
    expect(
      isKomariRootServiceWorker(
        registration(
          "https://komari.example/",
          "https://komari.example/sw.js?v=1",
        ),
        "https://komari.example",
      ),
    ).toBe(true);
    expect(
      isKomariRootServiceWorker(
        registration(
          "https://komari.example/app/",
          "https://komari.example/sw.js",
        ),
        "https://komari.example",
      ),
    ).toBe(false);
    expect(
      isKomariRootServiceWorker(
        registration(
          "https://komari.example/",
          "https://komari.example/custom-sw.js",
        ),
        "https://komari.example",
      ),
    ).toBe(false);
  });

  it("recognizes only admin paths", () => {
    expect(isAdminPath("/admin")).toBe(true);
    expect(isAdminPath("/admin/settings")).toBe(true);
    expect(isAdminPath("/administrator")).toBe(false);
  });

  it("redirects the admin root while preserving deeper routes", () => {
    expect(
      getAdminDestination({ pathname: "/admin", search: "?tab=1", hash: "" }),
    ).toBe("/admin/dashboard?tab=1");
    expect(
      getAdminDestination({
        pathname: "/admin/settings",
        search: "",
        hash: "#site",
      }),
    ).toBe("/admin/settings#site");
  });

  it("handles CacheStorage errors gracefully during repair", async () => {
    const originalCaches = globalThis.caches;
    vi.stubGlobal("caches", {
      keys: vi.fn(async () => {
        throw new Error("SecurityError: storage denied");
      }),
      delete: vi.fn(),
    });
    try {
      await expect(repairKomariServiceWorker()).resolves.toBeUndefined();
    } finally {
      vi.stubGlobal("caches", originalCaches);
    }
  });
});
