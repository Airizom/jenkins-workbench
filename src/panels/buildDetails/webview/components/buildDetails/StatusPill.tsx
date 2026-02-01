import { Badge } from "../../../../shared/webview/components/ui/badge";
import { cn } from "../../../../shared/webview/lib/utils";

const STATUS_CLASS_MAP: Record<string, string> = {
  success: "border-success-border text-success bg-success-soft",
  failure: "border-failure-border text-failure bg-failure-soft",
  unstable: "border-warning-border text-warning bg-warning-soft",
  aborted: "border-aborted-border text-aborted bg-aborted-soft",
  running: "border-warning-border text-warning bg-warning-soft",
  neutral: "border-border text-foreground bg-muted"
};

export function getStatusClass(status?: string): string {
  if (!status) {
    return STATUS_CLASS_MAP.neutral;
  }
  return STATUS_CLASS_MAP[status] ?? STATUS_CLASS_MAP.neutral;
}

export function StatusPill({
  label,
  status,
  className,
  id
}: {
  label: string;
  status?: string;
  className?: string;
  id?: string;
}) {
  const statusClass = getStatusClass(status);
  return (
    <Badge
      id={id}
      variant="outline"
      className={cn("text-xs font-semibold", statusClass, className)}
    >
      {label}
    </Badge>
  );
}
