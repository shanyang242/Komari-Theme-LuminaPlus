import type { ReactNode } from "react";
import { clsx } from "clsx";

export function InstancePanel({
  title,
  description,
  aside,
  children,
  className,
}: {
  title: string;
  description?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={clsx("instance-panel", className)}>
      <header className="instance-panel-header">
        <div className="instance-panel-headings">
          <h2 className="instance-panel-title">{title}</h2>
          {description && <p className="instance-panel-description">{description}</p>}
        </div>
        {aside && <div className="instance-panel-aside">{aside}</div>}
      </header>
      {children}
    </section>
  );
}
