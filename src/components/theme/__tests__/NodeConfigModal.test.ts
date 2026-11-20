import { describe, expect, it } from "vitest";
import type { AdminClient } from "@/types/komari";
import { resolveMerchantLinkUrl, type NodeMerchantLinks } from "@/utils/merchantLinks";
import {
  buildMerchantPanelClients,
  ORPHAN_MERCHANT_CLIENT_GROUP,
} from "@/components/theme/MerchantLinkConfigPanel";
import {
  filterConfigClients,
  resolveEffectiveConfigGroup,
  resolveSelectedConfigClient,
} from "@/components/theme/NodeConfigModal";

function client(uuid: string, name: string, group = "Default"): AdminClient {
  return { uuid, name, group, region: "HK", weight: 1 };
}

describe("NodeConfigModal selection pinning & group fallback", () => {
  const alpha = client("alpha", "Alpha");
  const beta = client("beta", "Beta");
  const gamma = client("gamma", "Gamma");
  const clients = [alpha, beta, gamma];

  it("keeps the actively edited node pinned under the 'configured' filter instead of jumping to the next node (regression)", () => {
    const linksAfterKeystroke: NodeMerchantLinks = {
      alpha: { url: "n", iconUrl: "" },
      beta: { url: "https://beta.example.com", iconUrl: "" },
    };
    const isClientConfigured = (item: AdminClient) =>
      Boolean(resolveMerchantLinkUrl(linksAfterKeystroke[item.uuid]?.url));

    const filteredWhileEditingAlpha = filterConfigClients({
      clients,
      filter: "configured",
      group: "",
      search: "",
      pinnedUuid: "alpha",
      isClientConfigured,
    });

    expect(filteredWhileEditingAlpha.map((c) => c.uuid)).toEqual(["alpha", "beta"]);
    expect(resolveSelectedConfigClient(filteredWhileEditingAlpha, "alpha")?.uuid).toBe("alpha");

    const filteredAfterSwitchingToBeta = filterConfigClients({
      clients,
      filter: "configured",
      group: "",
      search: "",
      pinnedUuid: "beta",
      isClientConfigured,
    });
    expect(filteredAfterSwitchingToBeta.map((c) => c.uuid)).toEqual(["beta"]);
    expect(resolveSelectedConfigClient(filteredAfterSwitchingToBeta, "beta")?.uuid).toBe("beta");
  });

  it("drops the stale selection when the user actively changes filter, group, or search", () => {
    const links: NodeMerchantLinks = {
      alpha: { url: "n", iconUrl: "" },
      beta: { url: "https://beta.example.com", iconUrl: "" },
    };
    const isClientConfigured = (item: AdminClient) =>
      Boolean(resolveMerchantLinkUrl(links[item.uuid]?.url));

    const strictMatches = filterConfigClients({
      clients,
      filter: "configured",
      group: "",
      search: "",
      isClientConfigured,
    });
    expect(strictMatches.map((c) => c.uuid)).toEqual(["beta"]);
  });

  it("resets the active group filter to all groups when the last item in that group disappears (regression)", () => {
    expect(resolveEffectiveConfigGroup(["Default", ORPHAN_MERCHANT_CLIENT_GROUP], ORPHAN_MERCHANT_CLIENT_GROUP))
      .toBe(ORPHAN_MERCHANT_CLIENT_GROUP);
    const effectiveGroup = resolveEffectiveConfigGroup(["Default"], ORPHAN_MERCHANT_CLIENT_GROUP);
    expect(effectiveGroup).toBe("");
    const remaining = filterConfigClients({
      clients: [alpha, beta],
      filter: "all",
      group: effectiveGroup,
      search: "",
      isClientConfigured: () => true,
    });
    expect(remaining.map((c) => c.uuid)).toEqual(["alpha", "beta"]);
  });
});

describe("buildMerchantPanelClients — orphaned & failed client-list guards", () => {
  it("lists orphaned UUIDs from deleted nodes when the client list is known (regression)", () => {
    const existing = [client("node-1", "Node 1"), client("node-2", "Node 2")];
    const links: NodeMerchantLinks = {
      "node-1": { url: "https://shop.example.com", iconUrl: "" },
      "deleted-uuid-99": { url: "invalid-legacy-url", iconUrl: "" },
    };

    const panelClients = buildMerchantPanelClients(existing, links, ["deleted-uuid-99"], true);
    expect(panelClients.map((c) => c.uuid)).toEqual(["node-1", "node-2", "deleted-uuid-99"]);
    expect(panelClients[2]).toMatchObject({
      uuid: "deleted-uuid-99",
      name: "deleted-uuid-99",
      group: ORPHAN_MERCHANT_CLIENT_GROUP,
    });

    const afterClear = buildMerchantPanelClients(
      existing,
      { "node-1": { url: "https://shop.example.com", iconUrl: "" } },
      [],
      true,
    );
    expect(afterClear.map((c) => c.uuid)).toEqual(["node-1", "node-2"]);
  });

  it("never misclassifies valid nodes as deleted orphans when /api/admin/client/list fails (regression)", () => {
    const links: NodeMerchantLinks = {
      "node-1": { url: "https://shop-1.example.com", iconUrl: "" },
      "node-2": { url: "https://shop-2.example.com", iconUrl: "" },
    };

    const panelClients = buildMerchantPanelClients([], links, [], false);
    expect(panelClients).toEqual([]);
  });
});
