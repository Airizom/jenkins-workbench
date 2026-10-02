import type * as React from "react";
import { EmptyState } from "../../../../../shared/webview/components/EmptyState";
import { Skeleton } from "../../../../../shared/webview/components/ui/skeleton";
import { TerminalIcon } from "../../../../../shared/webview/icons";

export function ConsoleOutputEmptyState({
  title = "No console output",
  description = "This build has not produced any log output yet."
}: {
  title?: string;
  description?: string;
}): React.JSX.Element {
  return (
    <EmptyState
      icon={<TerminalIcon className="h-4 w-4" />}
      title={title}
      description={description}
    />
  );
}

export function ConsoleOutputLoadingState({
  label = "Loading log…"
}: {
  label?: string;
}): React.JSX.Element {
  return (
    <div role="status" className="space-y-2 rounded border border-border bg-terminal px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div aria-hidden="true" className="space-y-2">
        <Skeleton className="h-3 w-4/5" />
        <Skeleton className="h-3 w-3/5" />
        <Skeleton className="h-3 w-[66%]" />
      </div>
    </div>
  );
}
