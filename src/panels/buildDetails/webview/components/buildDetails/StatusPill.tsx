import { Badge } from "../ui/badge";
import { cn } from "../../lib/utils";

const STATUS_CLASS_MAP: Record<string, string> = {
  success: "text-success",
  failure: "text-failure",
  unstable: "text-warning",
  aborted: "text-aborted",
  running: "text-warning",
  neutral: "text-foreground"
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
      className={cn("border-current bg-muted text-xs", statusClass, className)}
    >
      {label}
    </Badge>
  );
}
