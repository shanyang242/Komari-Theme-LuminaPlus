import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const homeCss = readFileSync(new URL("../home.css", import.meta.url), "utf8");
const surfaceCss = readFileSync(new URL("../surface.css", import.meta.url), "utf8");
const homeSource = readFileSync(new URL("../../pages/Home.tsx", import.meta.url), "utf8");
const controlsSource = readFileSync(
  new URL("../../components/shell/FloatingControls.tsx", import.meta.url),
  "utf8",
);
const nodeGridSource = readFileSync(
  new URL("../../components/node/NodeGrid.tsx", import.meta.url),
  "utf8",
);
const appShellSource = readFileSync(
  new URL("../../components/shell/AppShell.tsx", import.meta.url),
  "utf8",
);
const routerSource = readFileSync(new URL("../../router.tsx", import.meta.url), "utf8");

describe("home responsive layout contracts", () => {
  it("hides the brand while the controls are expanded through tablet widths", () => {
    expect(homeCss).toMatch(/@media \(max-width: 1023px\)[\s\S]*\.home-dashboard:has\(\.floating-controls:not\(\.is-collapsed\)\) \.home-brand/);
    expect(homeSource).not.toContain("onExpandedChange");
  });

  it("keeps both horizontal edges inside viewport safe areas", () => {
    expect(surfaceCss).toContain("env(safe-area-inset-left, 0px)");
    expect(surfaceCss).toContain("env(safe-area-inset-right, 0px)");
    expect(surfaceCss).toMatch(/padding-left:\s*max\(var\(--app-gutter\)/);
    expect(surfaceCss).toMatch(/padding-right:\s*max\(var\(--app-gutter\)/);
  });

  it("resets child panels on collapse and keeps home-only routing out of controls", () => {
    expect(controlsSource).toContain("if (nextCollapsed) setColorsOpen(false)");
    expect(controlsSource).not.toContain("useLocation");
    expect(controlsSource).not.toContain("useSearchParams");
    expect(controlsSource).not.toContain("usePublicConfig");
  });

  it("does not render zero-value overview cards before the node store is hydrated", () => {
    expect(nodeGridSource).toContain("hydrated: storeHydrated");
    expect(nodeGridSource).toContain("!themeSettings.isReady || !storeHydrated");
    expect(nodeGridSource.indexOf("!themeSettings.isReady || !storeHydrated")).toBeLessThan(
      nodeGridSource.indexOf("const homeHeader"),
    );
    const loadingBranch = nodeGridSource.slice(
      nodeGridSource.indexOf("!themeSettings.isReady || !storeHydrated"),
      nodeGridSource.indexOf("const homeHeader"),
    );
    expect(loadingBranch).not.toContain("<HomeBrand");
    expect(loadingBranch).not.toContain("<Spinner");
    expect(homeSource).toContain("const homeReady = themeSettings.isReady && storeHydrated");
    expect(homeSource).toContain("{homeReady && <FloatingControls");
  });

  it("keeps access and initial home hydration behind one shell-owned spinner", () => {
    expect(appShellSource).toContain("useNodeStoreStatus(canHydrateHome)");
    expect(appShellSource).toContain("isCheckingAccess || isCheckingHomeData");
    expect(appShellSource).toContain("isCheckingShell ?");
    expect(routerSource).toContain('import { Home } from "@/pages/Home"');
    expect(routerSource).not.toMatch(/const Home\s*=\s*lazy/);
    expect(routerSource).toContain("element: <Home />");
  });
});
