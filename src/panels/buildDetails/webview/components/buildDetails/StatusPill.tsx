import { Badge } from "../../../../shared/webview/components/ui/badge";
import { resolveResultBadgeClass } from "../../../../shared/webview/lib/statusStyles";
import { cn } from "../../../../shared/webview/lib/utils";

export function getStatusClass(status?: string): string {
  if (!status) {
    return resolveResultBadgeClass("neutral");
  }
  return resolveResultBadgeClass(status);
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
