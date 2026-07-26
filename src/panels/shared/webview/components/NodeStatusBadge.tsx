import type { NodeStatusClass } from "../../../nodeDetails/shared/NodeDetailsContracts";
import { resolveNodeStatusBadgeClass } from "../lib/statusStyles";
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
    <ToneBadge
      label={label}
      badgeClassName={resolveNodeStatusBadgeClass(statusClass)}
      className={className}
    />
  );
}
