import { Component, type ErrorInfo, type ReactNode } from "react";
import { isRouteErrorResponse, useRouteError } from "react-router-dom";

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

function reloadPage() {
  window.location.reload();
}

function ErrorFallback({
  title = "页面出错了",
  message,
}: {
  title?: string;
  message?: string;
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
    console.error("[komaritheme] render error", error, info);
  }

  render() {
    if (this.state.error) {
      return <ErrorFallback message={getErrorMessage(this.state.error)} />;
    }

    return this.props.children;
  }
}

export function RouteErrorFallback() {
  const error = useRouteError();

  if (isRouteErrorResponse(error)) {
    return (
      <ErrorFallback
        title={`${error.status} ${error.statusText || "路由错误"}`}
        message={typeof error.data === "string" ? error.data : "当前路由加载失败。"}
      />
    );
  }

  return <ErrorFallback message={getErrorMessage(error)} />;
}
