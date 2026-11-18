import { useCallback, useEffect, useMemo, useState } from "react";
import { Store } from "lucide-react";
import { MerchantIcon } from "@/components/ui/MerchantIcon";
import { NodeConfigModal } from "./NodeConfigModal";
import type { AdminClient } from "@/types/komari";
import {
  getMerchantLinkValidationErrors,
  resolveMerchantIconUrl,
  resolveMerchantLinkUrl,
  type NodeMerchantLinks,
} from "@/utils/merchantLinks";

export const ORPHAN_MERCHANT_CLIENT_GROUP = "已删除实例";

function isInvalid(links: NodeMerchantLinks, uuid: string) {
  const link = links[uuid];
  if (!link) return false;
  const { urlError, iconUrlError } = getMerchantLinkValidationErrors(link);
  return Boolean(urlError || iconUrlError);
}

/**
 * 将已不在当前节点列表中的遗留商家配置按 UUID 追加到面板列表末尾，供管理员查看、修正或显式清除。
 * 当后台节点列表尚未成功加载（`clientsKnown === false`，如接口 503）时，绝不将现存节点误判为已删除实例；
 * 仅在存在阻塞保存的格式错误记录时按 UUID 列出待修正项。
 */
export function buildMerchantPanelClients(
  clients: readonly AdminClient[],
  links: NodeMerchantLinks,
  retainedOrphanUuids: readonly string[] = [],
  clientsKnown = true,
): AdminClient[] {
  if (!clientsKnown) {
    const invalidUuids = Array.from(
      new Set([...retainedOrphanUuids, ...Object.keys(links).filter((uuid) => isInvalid(links, uuid))]),
    );
    return invalidUuids.map((uuid) => ({
      uuid,
      name: uuid,
      group: "",
      region: "",
      weight: Number.MAX_SAFE_INTEGER,
    }));
  }

  const existingUuids = new Set(clients.map((client) => client.uuid));
  const orphanUuids = Array.from(
    new Set([...retainedOrphanUuids, ...Object.keys(links)]),
  ).filter((uuid) => !existingUuids.has(uuid));

  if (orphanUuids.length === 0) return [...clients];

  return [
    ...clients,
    ...orphanUuids.map((uuid) => ({
      uuid,
      name: uuid,
      group: ORPHAN_MERCHANT_CLIENT_GROUP,
      region: "",
      weight: Number.MAX_SAFE_INTEGER,
    })),
  ];
}

interface MerchantLinkConfigPanelProps {
  open: boolean;
  clients: AdminClient[];
  clientsKnown?: boolean;
  links: NodeMerchantLinks;
  saving: boolean;
  saveDisabled: boolean;
  saveError: string | null;
  onChange: (next: NodeMerchantLinks) => void;
  onClose: () => void;
  onSave: () => Promise<boolean>;
}

function isConfigured(links: NodeMerchantLinks, uuid: string) {
  return Boolean(resolveMerchantLinkUrl(links[uuid]?.url));
}

export function MerchantLinkConfigPanel({
  open,
  clients,
  clientsKnown = true,
  links,
  saving,
  saveDisabled,
  saveError,
  onChange,
  onClose,
  onSave,
}: MerchantLinkConfigPanelProps) {
  const existingUuidSet = useMemo(
    () => new Set(clients.map((client) => client.uuid)),
    [clients],
  );

  // 记录本次打开期间出现过的额外 UUID：在输入框中退格清空文本时不立即从列表抽走该行，
  // 防止编辑焦点跳到其他节点；仅在点击清除按钮或重开面板时移除。
  const [retainedOrphanUuids, setRetainedOrphanUuids] = useState<string[]>(() =>
    clientsKnown
      ? Object.keys(links).filter((uuid) => !existingUuidSet.has(uuid))
      : Object.keys(links).filter((uuid) => isInvalid(links, uuid)),
  );

  useEffect(() => {
    if (!open) {
      setRetainedOrphanUuids([]);
      return;
    }
    setRetainedOrphanUuids((prev) => {
      const currentExtras = clientsKnown
        ? Object.keys(links).filter((uuid) => !existingUuidSet.has(uuid))
        : Object.keys(links).filter((uuid) => isInvalid(links, uuid));
      const keptPrev = clientsKnown
        ? prev.filter((uuid) => !existingUuidSet.has(uuid))
        : prev;
      const merged = Array.from(new Set([...keptPrev, ...currentExtras]));
      return merged.length === prev.length && merged.every((uuid, idx) => uuid === prev[idx])
        ? prev
        : merged;
    });
  }, [clientsKnown, existingUuidSet, links, open]);

  const panelClients = useMemo(
    () => buildMerchantPanelClients(clients, links, retainedOrphanUuids, clientsKnown),
    [clients, clientsKnown, links, retainedOrphanUuids],
  );

  const firstInvalidUuid = useMemo(
    () => panelClients.find((client) => isInvalid(links, client.uuid))?.uuid,
    [links, panelClients],
  );

  const isClientConfigured = useCallback(
    (client: AdminClient) => isConfigured(links, client.uuid),
    [links],
  );

  const isClientInvalid = useCallback(
    (client: AdminClient) => isInvalid(links, client.uuid),
    [links],
  );

  const getClientSummary = useCallback(
    (client: AdminClient) => {
      const isOrphan = clientsKnown && !existingUuidSet.has(client.uuid);
      const prefix = isOrphan ? "遗留项 · " : "";
      const link = links[client.uuid];
      if (!link) return isOrphan ? `${prefix}已清空（待保存）` : "未配置 · 显示默认图标";
      const { urlError, iconUrlError } = getMerchantLinkValidationErrors(link);
      if (urlError || iconUrlError) return `${prefix}地址格式无效 · 请修正或清除`;
      const resolvedUrl = resolveMerchantLinkUrl(link.url);
      if (resolvedUrl) return `${prefix}${resolvedUrl}`;
      if (resolveMerchantIconUrl(link.iconUrl)) return `${prefix}仅配置图标 · 未启用跳转`;
      return `${prefix}未配置 · 显示默认图标`;
    },
    [clientsKnown, existingUuidSet, links],
  );

  const renderEditor = (selectedClient: AdminClient) => {
    const isOrphan = clientsKnown && !existingUuidSet.has(selectedClient.uuid);
    const selectedLink = links[selectedClient.uuid] ?? { url: "", iconUrl: "" };
    const { urlError, iconUrlError } = getMerchantLinkValidationErrors(selectedLink);
    const resolvedUrl = resolveMerchantLinkUrl(selectedLink.url);
    const resolvedIconUrl = resolveMerchantIconUrl(selectedLink.iconUrl);
    const selectedConfigured = Boolean(resolvedUrl) && !urlError;

    const patchSelected = (field: "url" | "iconUrl", value: string) => {
      const next = { ...links };
      const entry = { ...selectedLink, [field]: value };
      if (!entry.url.trim() && !entry.iconUrl.trim()) delete next[selectedClient.uuid];
      else next[selectedClient.uuid] = entry;
      onChange(next);
    };

    const clearSelected = () => {
      const next = { ...links };
      delete next[selectedClient.uuid];
      setRetainedOrphanUuids((prev) => prev.filter((uuid) => uuid !== selectedClient.uuid));
      onChange(next);
    };

    return (
      <>
        {!clientsKnown && (
          <div className="surface-inset border border-[color-mix(in_srgb,var(--status-offline)_28%,transparent)] px-3.5 py-2.5 text-[12px] leading-relaxed text-[var(--text-secondary)]">
            后台节点列表读取失败，当前无法核对实例是否已删除，仅列出存在格式错误的 UUID 供修正。
          </div>
        )}
        {isOrphan && (
          <div className="surface-inset border border-[color-mix(in_srgb,var(--status-offline)_28%,transparent)] px-3.5 py-2.5 text-[12px] leading-relaxed text-[var(--text-secondary)]">
            该 UUID（<code className="font-mono text-[11px]">{selectedClient.uuid}</code>
            ）对应的实例已不在当前节点列表中，可在此修正或直接清除这条遗留记录。
          </div>
        )}

        <div>
          <div className="text-[13px] font-medium text-[var(--text-primary)]">商家跳转设置</div>
          <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
            官网为空时卡片只显示不可点击的默认商家图标，不会触发跳转。
          </p>
        </div>

        <div className="surface-inset flex items-center gap-3 px-4 py-3">
          <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-lg bg-[var(--fill-tertiary)] text-[var(--text-tertiary)]">
            <MerchantIcon
              enabled={selectedConfigured}
              iconUrl={selectedConfigured ? resolvedIconUrl : ""}
              size={15}
            />
          </span>
          <span className="min-w-0">
            <strong className="block text-[12px] font-medium text-[var(--text-primary)]">
              卡片图标预览
            </strong>
            <span
              className={
                urlError
                  ? "mt-1 block text-[11px] text-[var(--status-offline)]"
                  : "mt-1 block truncate text-[11px] text-[var(--text-tertiary)]"
              }
            >
              {urlError
                ? "官网地址格式无效，修正后才可跳转"
                : selectedConfigured
                  ? `点击后将在新标签页打开：${resolvedUrl}`
                  : "未配置跳转"}
            </span>
          </span>
        </div>

        <label className="flex flex-col gap-2">
          <span className="text-[12px] font-medium text-[var(--text-secondary)]">
            商家官网地址
          </span>
          <input
            value={selectedLink.url}
            onChange={(event) => patchSelected("url", event.target.value)}
            placeholder="https://example.com 或 example.com:8443/shop"
            aria-invalid={Boolean(urlError)}
            className="surface-inset w-full px-3 py-2.5 text-[13px] outline-none"
          />
          {urlError && (
            <span role="alert" className="text-[11px] leading-relaxed text-[var(--status-offline)]">
              {urlError}
            </span>
          )}
        </label>

        <label className="flex flex-col gap-2">
          <span className="text-[12px] font-medium text-[var(--text-secondary)]">
            商家图标地址（可选）
          </span>
          <input
            value={selectedLink.iconUrl}
            onChange={(event) => patchSelected("iconUrl", event.target.value)}
            placeholder="https://example.com/logo.png 或 images/shop.svg"
            aria-invalid={Boolean(iconUrlError)}
            className="surface-inset w-full px-3 py-2.5 text-[13px] outline-none"
          />
          {iconUrlError ? (
            <span role="alert" className="text-[11px] leading-relaxed text-[var(--status-offline)]">
              {iconUrlError}
            </span>
          ) : (
            <span className="text-[11px] leading-relaxed text-[var(--text-tertiary)]">
              不自动读取网站图标；留空或加载失败时使用默认商家图标。
            </span>
          )}
        </label>

        {(isOrphan || selectedLink.url || selectedLink.iconUrl) && (
          <button
            type="button"
            onClick={clearSelected}
            className="theme-manage-button is-danger self-start"
          >
            {isOrphan ? "清除此遗留配置" : "清除当前实例配置"}
          </button>
        )}
      </>
    );
  };

  return (
    <NodeConfigModal
      open={open}
      titleId="merchant-config-title"
      badgeIcon={<Store size={14} />}
      badgeLabel="商家跳转"
      title="按实例配置商家官网"
      clients={panelClients}
      initialSelectedUuid={firstInvalidUuid}
      configuredFilterLabel="已配置"
      unconfiguredFilterLabel="未配置"
      configuredBadgeLabel="已配置"
      saving={saving}
      saveDisabled={saveDisabled}
      saveError={saveError}
      isClientConfigured={isClientConfigured}
      isClientInvalid={isClientInvalid}
      getClientSummary={getClientSummary}
      renderEditor={renderEditor}
      onClose={onClose}
      onSave={onSave}
    />
  );
}
