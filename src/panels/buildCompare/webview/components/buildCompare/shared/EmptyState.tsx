import { CheckCircleIcon } from "../../../../../shared/webview/icons";
export function EmptyState({
  label,
  tone = "muted"
}: {
  label: string;
  tone?: "muted" | "success";
}) {
  if (tone === "success") {
    return (
      <div className="flex items-center gap-2 rounded-md border border-success-border bg-success-soft px-3 py-4 text-sm text-success-foreground">
        <CheckCircleIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
        {label}
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-dashed border-mutedBorder px-3 py-4 text-sm text-muted-foreground">
      {label}
    </div>
  );
}
