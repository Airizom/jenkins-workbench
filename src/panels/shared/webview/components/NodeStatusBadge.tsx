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
      className={cn("text-[10px] px-1.5 py-0", resolveNodeStatusBadgeClass(statusClass), className)}
    >
      {label}
    </Badge>
  );
}
