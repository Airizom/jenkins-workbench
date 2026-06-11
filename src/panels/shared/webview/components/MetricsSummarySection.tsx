import type { ReactNode } from "react";
export function MetricsSummarySection({
  icon,
  title,
  badge,
  description,
  metrics,
  footer
}: {
  icon: ReactNode;
  title: string;
  badge?: ReactNode;
  description?: ReactNode;
  metrics: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="rounded border border-border bg-muted-soft p-3 space-y-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded border border-border bg-background">
            {icon}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-foreground">{title}</span>
              {badge}
            </div>
            {description ? (
              <div className="text-xs text-muted-foreground">{description}</div>
            ) : null}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{metrics}</div>
      </div>
      {footer}
    </div>
  );
}
