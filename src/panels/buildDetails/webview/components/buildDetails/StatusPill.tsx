import { Badge } from "../../../../shared/webview/components/ui/badge";
import { cn } from "../../../../shared/webview/lib/utils";

const STATUS_CLASS_MAP: Record<string, string> = {
  success: "border-success/50 text-success bg-success/10",
  failure: "border-failure/50 text-failure bg-failure/10",
  unstable: "border-warning/50 text-warning bg-warning/10",
  aborted: "border-aborted/50 text-aborted bg-aborted/10",
  running: "border-warning/50 text-warning bg-warning/10",
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
      className={cn("border text-xs font-medium", statusClass, className)}
    >
      {label}
    </Badge>
  );
}
