import type { ReactNode } from "react";
import { cn } from "../../../../../shared/webview/lib/utils";
export function CompareSideGrid({
  children,
  columns = 2,
  className
}: {
  children: ReactNode;
  columns?: 2 | 3;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid gap-2 text-xs",
        columns === 3 ? "sm:grid-cols-3 sm:gap-4" : "min-w-0 sm:grid-cols-2 sm:gap-4",
        className
      )}
    >
      {children}
    </div>
  );
}
