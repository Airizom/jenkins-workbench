import { AlertCircleIcon, SearchIcon, TestTubeIcon } from "../../../../../shared/webview/icons";
import type { EmptyStateIcon } from "./testResultsTypes";

export function TestResultsEmptyState({
  icon,
  title,
  message
}: {
  icon?: EmptyStateIcon;
  title: string;
  message: string;
}) {
  return (
    <div className="rounded border border-dashed border-border bg-muted-soft px-4 py-8 text-center">
      {icon ? (
        <div className="mx-auto mb-2.5 flex h-8 w-8 items-center justify-center rounded-full bg-muted">
          <EmptyStateGlyph icon={icon} />
        </div>
      ) : null}
      <div className="text-sm font-medium text-foreground">{title}</div>
      <div className="mt-1 text-xs text-muted-foreground">{message}</div>
    </div>
  );
}

function EmptyStateGlyph({ icon }: { icon: EmptyStateIcon }) {
  switch (icon) {
    case "loading":
      return <TestTubeIcon className="h-4 w-4 animate-pulse text-muted-foreground" />;
    case "info":
      return <AlertCircleIcon className="h-4 w-4 text-warning" />;
    case "empty":
      return <TestTubeIcon className="h-4 w-4 text-muted-foreground" />;
    case "search":
      return <SearchIcon className="h-4 w-4 text-muted-foreground" />;
  }
}
