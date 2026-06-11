import { resolveSeverityBadgeClass } from "../lib/statusStyles";
import { cn } from "../lib/utils";
import { Badge } from "./ui/badge";
export function SeverityBadge({
  label,
  severity,
  className
}: {
  label: string;
  severity: "critical" | "warning" | "normal";
  className?: string;
}) {
  return (
    <Badge
      variant="outline"
      className={cn("text-[11px]", resolveSeverityBadgeClass(severity), className)}
    >
      {label}
    </Badge>
  );
}
