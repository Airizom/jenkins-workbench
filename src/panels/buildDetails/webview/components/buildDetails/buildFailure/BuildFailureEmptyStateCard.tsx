import { InfoIcon } from "../../../../../shared/webview/icons";

export function BuildFailureEmptyStateCard({ title }: { title: string }) {
  return (
    <div className="rounded border border-dashed border-border bg-muted-soft px-3 py-6 text-center">
      <div className="flex flex-col items-center gap-2">
        <InfoIcon className="h-6 w-6" />
        <div className="text-xs font-medium text-muted-foreground">{title}</div>
        <div className="text-[11px] text-muted-foreground">
          No changelog, failed tests, or artifacts reported.
        </div>
      </div>
    </div>
  );
}
