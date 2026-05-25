import type { ReactNode } from "react";
import { cn } from "../../../../../shared/webview/lib/utils";

export function CompareMutedCard({
  children,
  className
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-lg border border-border bg-muted-soft px-3 py-2", className)}>
      {children}
    </div>
  );
}
