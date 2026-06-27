import type { ReactNode } from "react";
import { clsx } from "clsx";
import { Spinner } from "@/components/ui/Spinner";

export function InstancePanel({
  title,
  titleAction,
  description,
  aside,
  children,
  className,
}: {
  title: string;
  /** 紧贴标题文字之后的内联控件（如详情页的服务器切换器）。 */
  titleAction?: ReactNode;
  description?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={clsx("instance-panel", className)}>
      <header className="instance-panel-header">
        <div className="instance-panel-headings">
          <div className="instance-panel-title-row">
            <h2 className="instance-panel-title">{title}</h2>
            {titleAction}
          </div>
          {description && <p className="instance-panel-description">{description}</p>}
        </div>
        {aside && <div className="instance-panel-aside">{aside}</div>}
      </header>
      {children}
    </section>
  );
}

// 图表加载态:带标题面板 + 居中 Spinner + 文案。LoadChart/PingChart 共用,避免各写一份漂移。
export function InstanceChartLoading({ title }: { title: string }) {
  return (
    <InstancePanel title={title}>
      <div className="instance-chart-loading" aria-busy>
        <Spinner size={26} />
        <span>加载中…</span>
      </div>
    </InstancePanel>
  );
}
