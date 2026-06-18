import { Component, useEffect, type CSSProperties, type ErrorInfo, type ReactNode } from "react";
import { isRouteErrorResponse, useRouteError } from "react-router-dom";
import { readViewModeHint, useViewMode } from "@/hooks/useViewMode";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return "页面渲染时发生异常";
}

// One compact block so a user screenshot — or a console line — tells us at a glance
// which layer crashed: error.name + stack pinpoint the call site (router vs a card
// effect vs the big-card canvas), and `mode` says whether they were on the compact
// or large card, which the stack alone doesn't reveal.
// Path + the `view` flag only — never the full query/hash, which could carry a
// token in the future and would then leak through a user's screenshot of this page.
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

function copyDiagnostics(text: string) {
  try {
    void navigator.clipboard?.writeText(text);
  } catch {
    // Clipboard may be unavailable (insecure context / old browser); the text is
    // still visible in the <pre> for manual selection.
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
          <p className="theme-error-kicker">komaritheme</p>
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
              onClick={() => copyDiagnostics(diagnostics)}
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
    // readViewModeHint avoids hooks (we're in a class). It reports device +
    // override, not the fully-resolved mode, but that's enough to tell compact
    // from large for triage.
    console.error(
      "[komaritheme] render error\n" + buildDiagnostics(error, readViewModeHint()),
      info,
    );
  }

  render() {
    if (this.state.error) {
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
  // The error element renders inside the providers, so the hook works here and
  // gives the fully-resolved view mode (the value the crashed tree was using).
  const { mode, device } = useViewMode();
  const diagnostics = buildDiagnostics(error, `${device}/${mode}`);

  useEffect(() => {
    console.error("[komaritheme] route error\n" + diagnostics);
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
