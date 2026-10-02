import * as React from "react";
import { Badge } from "../../../../../shared/webview/components/ui/badge";
import { cn } from "../../../../../shared/webview/lib/utils";
export function CompareSectionFrame({
  title,
  count,
  total,
  children,
  description,
  tone = "neutral"
}: {
  title: string;
  count: number;
  /** When set and larger than count, the badge reads "count of total". */
  total?: number;
  children: React.ReactNode;
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
        <Badge variant={tone === "failure" && count > 0 ? "failure" : "muted"}>
          {total !== undefined && total !== count
            ? `${count.toLocaleString()} of ${total.toLocaleString()}`
            : count.toLocaleString()}
        </Badge>
      </div>
      {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      {count > 0 ? <div className="space-y-2">{children}</div> : null}
    </div>
  );
}
