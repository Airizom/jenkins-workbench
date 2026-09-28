import * as React from "react";
import { Badge } from "../../../../../shared/webview/components/ui/badge";
import { cn } from "../../../../../shared/webview/lib/utils";
import { CompareEmptyState } from "./CompareEmptyState";
export function CompareSectionFrame({
  title,
  count,
  children,
  emptyLabel,
  description,
  tone = "neutral"
}: {
  title: string;
  count: number;
  children: React.ReactNode;
  emptyLabel?: string;
  /** Explanatory copy shown under the heading. */
  description?: string;
  tone?: "neutral" | "failure";
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <h4
          className={cn(
            "text-sm font-semibold",
            tone === "failure" && count > 0 && "text-failure-foreground"
          )}
        >
          {title}
        </h4>
        <Badge variant={tone === "failure" && count > 0 ? "failure" : "muted"}>{count}</Badge>
      </div>
      {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      {count > 0 ? (
        <div className="space-y-2">{children}</div>
      ) : emptyLabel ? (
        <CompareEmptyState label={emptyLabel} />
      ) : null}
    </div>
  );
}
