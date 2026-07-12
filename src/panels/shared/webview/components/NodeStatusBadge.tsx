import type { NodeStatusClass } from "../../../nodeDetails/shared/NodeDetailsContracts";
import { resolveNodeStatusBadgeClass } from "../lib/statusStyles";
import { cn } from "../lib/utils";
import { Badge } from "./ui/badge";
export function NodeStatusBadge({
  label,
  statusClass,
  className
}: {
  label: string;
  statusClass: NodeStatusClass;
  className?: string;
}) {
  return (
    <Badge
      variant="outline"
      size="sm"
      className={cn(resolveNodeStatusBadgeClass(statusClass), className)}
    >
      {label}
    </Badge>
  );
}
