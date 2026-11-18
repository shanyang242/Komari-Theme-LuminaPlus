import { describe, expect, it } from "vitest";
import { resolveInstanceAccessState } from "@/pages/Instance";

describe("resolveInstanceAccessState", () => {
  it("keeps backend-hidden nodes in loading state while /api/me is pending (regression)", () => {
    expect(
      resolveInstanceAccessState({
        hasMeta: true,
        metaHidden: true,
        isThemeHidden: false,
        authPending: true,
        loggedIn: false,
        storeHydrated: true,
        nodeInfoError: false,
      }),
    ).toBe("loading");
  });

  it("allows logged-in administrators to view backend-hidden nodes once auth resolves", () => {
    expect(
      resolveInstanceAccessState({
        hasMeta: true,
        metaHidden: true,
        isThemeHidden: false,
        authPending: false,
        loggedIn: true,
        storeHydrated: true,
        nodeInfoError: false,
      }),
    ).toBe("ready");
  });

  it("returns not_found for guests visiting backend-hidden nodes after auth resolves", () => {
    expect(
      resolveInstanceAccessState({
        hasMeta: true,
        metaHidden: true,
        isThemeHidden: false,
        authPending: false,
        loggedIn: false,
        storeHydrated: true,
        nodeInfoError: false,
      }),
    ).toBe("not_found");
  });

  it("immediately returns not_found for theme-hidden nodes without waiting for auth", () => {
    expect(
      resolveInstanceAccessState({
        hasMeta: true,
        metaHidden: true,
        isThemeHidden: true,
        authPending: true,
        loggedIn: true,
        storeHydrated: true,
        nodeInfoError: false,
      }),
    ).toBe("not_found");
  });
});
