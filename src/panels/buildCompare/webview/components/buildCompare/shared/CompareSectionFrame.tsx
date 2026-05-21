import * as React from "react";
import { Badge } from "../../../../../shared/webview/components/ui/badge";
import { EmptyState } from "./EmptyState";

export function CompareSectionFrame({
  title,
  count,
  children,
  emptyLabel
}: {
  title: string;
  count: number;
  children: React.ReactNode;
  emptyLabel: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        <Badge variant="muted">{count}</Badge>
      </div>
      {count > 0 ? <div className="space-y-2">{children}</div> : <EmptyState label={emptyLabel} />}
    </div>
  );
}
