import type * as React from "react";
import { cn } from "../../../../shared/webview/lib/utils";

type OverviewCardProps = {
  icon: React.JSX.Element;
  title: string;
  meta?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
};
export function OverviewCard({
  icon,
  title,
  meta,
  children,
  className
}: OverviewCardProps): React.JSX.Element {
  return (
    <section
      className={cn(
        "overflow-hidden rounded-lg border border-card-border bg-card shadow-sm",
        className
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border bg-surface-raised px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          {icon}
          <h2 className="m-0 truncate text-xs font-semibold">{title}</h2>
        </div>
        {meta ? <div className="shrink-0 text-[11px] text-muted-foreground">{meta}</div> : null}
      </div>
      <div className="p-3">{children}</div>
    </section>
  );
}
