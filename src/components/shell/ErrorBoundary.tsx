import { Component, useEffect, type CSSProperties, type ErrorInfo, type ReactNode } from "react";
import { isRouteErrorResponse, useRouteError } from "react-router-dom";
import { readViewModeHint, useViewMode } from "@/hooks/useViewMode";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error) => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return "页面渲染时发生异常";
}

// 只取 path 和 view 标记,不带完整 query/hash:以后这些里可能夹带 token,
// 会通过用户截图泄露出去。
function safeLocation(): string {
  if (typeof location === "undefined") return "(n/a)";
  const view = /[?&]view=([^&]+)/.exec(location.search || "");
  return `${location.origin}${location.pathname}${view ? `?view=${view[1]}` : ""}`;
}

function buildDiagnostics(error: unknown, mode: string): string {
  const err = error instanceof Error ? error : null;
  return [
    `name: ${err?.name ?? typeof error}`,
    `message: ${getErrorMessage(error)}`,
    `mode: ${mode}`,
    `url: ${safeLocation()}`,
    `ua: ${typeof navigator !== "undefined" ? navigator.userAgent : "(n/a)"}`,
    `stack: ${err?.stack ?? "(none)"}`,
  ].join("\n");
}

async function copyDiagnostics(text: string) {
  try {
    await navigator.clipboard?.writeText(text);
  } catch {
    // 文本仍保留在页面中，可手动复制。
  }
}

function reloadPage() {
  window.location.reload();
}

const preStyle: CSSProperties = {
  margin: "8px 0 0",
  maxHeight: "9rem",
  overflow: "auto",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  fontFamily: "var(--font-mono)",
  fontSize: "11px",
  lineHeight: 1.45,
  color: "var(--text-secondary)",
  background: "var(--surface-elev)",
  border: "1px solid var(--hairline)",
  borderRadius: "8px",
  padding: "8px 10px",
  userSelect: "text",
};

function ErrorFallback({
  title = "页面出错了",
  message,
  diagnostics,
}: {
  title?: string;
  message?: string;
  diagnostics?: string;
}) {
  return (
    <div className="theme-error-shell">
      <section className="theme-error-card" role="alert">
        <div>
          <p className="theme-error-kicker">LuminaPlus</p>
          <h1 className="theme-error-title">{title}</h1>
          <p className="theme-error-message">
            {message || "可以刷新页面，或返回首页重新进入。"}
          </p>
        </div>
        {diagnostics && (
          <details style={{ fontSize: "12px", color: "var(--text-tertiary)" }}>
            <summary style={{ cursor: "pointer", userSelect: "none" }}>
              诊断信息（反馈时请一并截图或复制）
            </summary>
            <pre style={preStyle}>{diagnostics}</pre>
            <button
              type="button"
              className="theme-error-button"
              onClick={() => void copyDiagnostics(diagnostics)}
            >
              复制诊断信息
            </button>
          </details>
        )}
        <div className="theme-error-actions">
          <button type="button" className="theme-error-button is-primary" onClick={reloadPage}>
            刷新
          </button>
          <a href="/" className="theme-error-button">
            返回首页
          </a>
        </div>
      </section>
    </div>
  );
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.props.onError?.(error);
    // 类组件里用不了 hook,所以用 readViewModeHint。它给的是 device + override 而非最终解析的 mode,但区分 compact/large 排查问题足够了
    console.error(
      "[LuminaPlus] render error\n" + buildDiagnostics(error, readViewModeHint()),
      info,
    );
  }

  render() {
    if (this.state.error) {
      if (this.props.fallback !== undefined) return this.props.fallback;
      return (
        <ErrorFallback
          message={getErrorMessage(this.state.error)}
          diagnostics={buildDiagnostics(this.state.error, readViewModeHint())}
        />
      );
    }

    return this.props.children;
  }
}

export function RouteErrorFallback() {
  const error = useRouteError();
  // error element 渲染在 providers 内部,所以这里 hook 可用,拿到的是崩溃那棵树实际用的最终 view mode
  const { mode, device } = useViewMode();
  const diagnostics = buildDiagnostics(error, `${device}/${mode}`);

  useEffect(() => {
    console.error("[LuminaPlus] route error\n" + diagnostics);
  }, [diagnostics]);

  if (isRouteErrorResponse(error)) {
    return (
      <ErrorFallback
        title={`${error.status} ${error.statusText || "路由错误"}`}
        message={typeof error.data === "string" ? error.data : "当前路由加载失败。"}
        diagnostics={diagnostics}
      />
    );
  }

  return <ErrorFallback message={getErrorMessage(error)} diagnostics={diagnostics} />;
}
