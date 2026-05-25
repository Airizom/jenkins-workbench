import type { ReactNode } from "react";

export function CompareDiffRowShell({
  title,
  changeType,
  titleClassName,
  children
}: {
  title: string;
  changeType: string;
  titleClassName?: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-muted-soft px-3 py-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={`text-sm font-medium ${titleClassName ?? ""}`.trim()}>{title}</p>
          <p className="mt-1 text-xs capitalize text-muted-foreground">{changeType}</p>
        </div>
        {children}
      </div>
    </div>
  );
}
