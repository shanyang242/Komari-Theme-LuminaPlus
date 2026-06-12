import { lazy, Suspense } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { NodeGrid } from "@/components/node/NodeGrid";
import { Spinner } from "@/components/ui/Spinner";
import { useAuth } from "@/hooks/useAuth";

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

  return (
    <div className="py-2">
      <NodeGrid />
    </div>
  );
}
