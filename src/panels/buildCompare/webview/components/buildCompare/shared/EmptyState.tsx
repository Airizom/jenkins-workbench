import { EmptyState as SharedEmptyState } from "../../../../../shared/webview/components/EmptyState";
import { CheckCircleIcon, MinusIcon } from "../../../../../shared/webview/icons";
export function EmptyState({
  label,
  tone = "muted"
}: {
  label: string;
  tone?: "muted" | "success";
}) {
  if (tone === "success") {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-success-border bg-success-soft px-3 py-3 text-sm text-success-foreground">
        <CheckCircleIcon className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
        {label}
      </div>
    );
  }
  return (
    <SharedEmptyState title={label} icon={<MinusIcon className="h-4 w-4" />} className="py-6" />
  );
}
