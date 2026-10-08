import { Save } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";

export function ThemeConfigSaveFooter({
  saving,
  saveDisabled,
  saveError,
  onClose,
  onSave,
}: {
  saving: boolean;
  saveDisabled: boolean;
  saveError: string | null;
  onClose: () => void;
  onSave: () => Promise<boolean>;
}) {
  return (
    <footer className="multi-ping-config-footer">
      {saveError ? (
        <span
          role="alert"
          className="multi-ping-config-footer-error text-[11px] text-[var(--status-error)]"
        >
          {saveError}
        </span>
      ) : (
        <span className="multi-ping-config-footer-hint text-[11px] text-[var(--text-tertiary)]">
          这里的修改会和其他主题设置一起保存。
        </span>
      )}
      <div className="multi-ping-config-footer-actions flex items-center gap-2">
        <button type="button" onClick={onClose} className="theme-manage-button">
          关闭
        </button>
        <button
          type="button"
          disabled={saveDisabled || saving}
          onClick={() => void onSave().then((saved) => saved && onClose())}
          className="theme-manage-button is-primary"
        >
          {saving ? <Spinner size={14} /> : <Save size={14} />}
          {saving ? "保存中" : "保存设置"}
        </button>
      </div>
    </footer>
  );
}
