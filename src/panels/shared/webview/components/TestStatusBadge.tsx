import { type NormalizedTestStatus, resolveTestStatusBadgeClass } from "../../TestStatusFormatters";
import { cn } from "../lib/utils";
import { Badge } from "./ui/badge";

export function TestStatusBadge({
  status,
  label,
  className
}: {
  status: NormalizedTestStatus;
  label: string;
  className?: string;
}) {
  return (
    <Badge
      variant="outline"
      className={cn("text-[10px] px-1.5 py-0", resolveTestStatusBadgeClass(status), className)}
    >
      {label}
    </Badge>
  );
}
