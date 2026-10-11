import type { ReactNode } from "react";
import { cn } from "../../../../../shared/webview/lib/utils";
export function BuildFailureInsightCard({
  icon,
  title,
  headerExtra,
  children
}: {
  icon: ReactNode;
  title: string;
  headerExtra?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="rounded border border-border p-3 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          {icon}
          <span className="text-caption font-semibold uppercase tracking-wide text-muted-foreground">
            {title}
          </span>
        </div>
        {headerExtra}
      </div>
      {children}
    </div>
  );
}
export function BuildFailureInsightEmpty({
  className,
  children
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-center rounded border border-dashed border-border bg-muted-soft px-2.5 py-3 text-xs text-muted-foreground",
        className
      )}
    >
      {children}
    </div>
  );
}
