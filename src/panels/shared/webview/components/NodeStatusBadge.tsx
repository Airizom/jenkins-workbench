import type { NodeStatusClass } from "../../../nodeDetails/shared/NodeDetailsContracts";
import { resolveNodeStatusBadgeClass } from "../lib/statusStyles";
import { cn } from "../lib/utils";
import { ToneBadge } from "./ToneBadge";
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
    <ToneBadge label={label} className={cn(resolveNodeStatusBadgeClass(statusClass), className)} />
  );
}
