import { lazy, Suspense } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { Lock } from "lucide-react";
import { NodeGrid } from "@/components/node/NodeGrid";
import { Spinner } from "@/components/ui/Spinner";
import { useAuth } from "@/hooks/useAuth";
import { usePublicConfig } from "@/hooks/usePublicConfig";

const ThemeManage = lazy(() =>
  import("@/pages/ThemeManage").then((module) => ({ default: module.ThemeManage })),
);

export function Home() {
  const [searchParams] = useSearchParams();
  const {
    data: me,
    isPending: authPending,
    isFetching: authFetching,
    error: authError,
    refetch: refetchAuth,
  } = useAuth();
  const { data: publicConfig } = usePublicConfig();
  const isThemeManageView = searchParams.get("view") === "theme-manage";

  if (isThemeManageView) {
    if (me?.logged_in) {
      return (
        <Suspense
          fallback={
            <div className="flex min-h-[60vh] items-center justify-center">
              <Spinner size={24} />
            </div>
          }
        >
          <ThemeManage />
        </Suspense>
      );
    }

    if (authPending || (!me && authFetching)) {
      return (
        <div className="flex min-h-[60vh] items-center justify-center">
          <Spinner size={24} />
        </div>
      );
    }

    if (authError) {
      return (
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
          <div className="space-y-2">
            <div className="text-[15px] font-semibold text-[var(--text-primary)]">
              无法确认当前登录状态
            </div>
            <p className="max-w-[32rem] text-[13px] text-[var(--text-secondary)]">
              {authError instanceof Error ? authError.message : "请稍后重试。"}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => {
                void refetchAuth();
              }}
              className="control-button px-4 py-2 text-[13px] font-medium"
            >
              重试
            </button>
            <Link to="/" className="control-button px-4 py-2 text-[13px] font-medium">
              返回首页
            </Link>
          </div>
        </div>
      );
    }

    return <Navigate to="/" replace />;
  }

  // Private-site gate — mirrors the purcarte theme's "go to login" screen,
  // restyled to ours. The backend whitelists /api/public and /api/me even on a
  // private site (web/api/Auth.go publicPaths) precisely so the frontend can
  // detect this state and prompt login, instead of letting every node request
  // 401 into a blank grid.
  //
  // We render the grid by default and only swap in the gate once we POSITIVELY
  // know the site is private AND the visitor resolved as logged-out. This avoids
  // blocking the common public path on /api/public (no full-page spinner there),
  // and waiting on authPending means a logged-in visitor on a private site never
  // sees a gate flash. A transient /api/public failure falls through to the grid
  // (we can't know it's private), which is the accepted trade-off.
  if (publicConfig?.private_site === true && !authPending && me?.logged_in !== true) {
    return <PrivateSiteGate />;
  }

  return (
    <div className="py-2">
      <NodeGrid />
    </div>
  );
}

// Shown on a private site to an anonymous visitor. Login itself is owned by the
// Komari backend (password / OAuth / 2FA all live at /admin), so we link there in
// a new tab rather than reimplementing an auth form. useAuth's refetchOnWindowFocus
// then revalidates when the visitor returns, so this gate clears on its own once
// they have logged in — no manual refresh needed.
function PrivateSiteGate() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <div className="grid h-12 w-12 place-items-center rounded-full bg-[var(--surface-elev)] text-[var(--text-tertiary)]">
        <Lock size={22} strokeWidth={2} />
      </div>
      <div className="space-y-2">
        <div className="text-[15px] font-semibold text-[var(--text-primary)]">
          站点已设为私有
        </div>
        <p className="max-w-[32rem] text-[13px] text-[var(--text-secondary)]">
          登录后即可查看节点数据。
        </p>
      </div>
      <a
        href="/admin"
        target="_blank"
        rel="noopener noreferrer"
        className="control-button px-4 py-2 text-[13px] font-medium"
      >
        前往登录
      </a>
    </div>
  );
}
