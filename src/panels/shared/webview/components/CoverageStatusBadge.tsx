import { resolveCoverageStatusBadgeClass } from "../../TestStatusStyles";
import { ToneBadge } from "./ToneBadge";
export function CoverageStatusBadge({
  label,
  statusClass,
  className
}: {
  label: string;
  statusClass?: string;
  className?: string;
}) {
  return (
    <ToneBadge
      label={label}
      badgeClassName={resolveCoverageStatusBadgeClass(statusClass)}
      className={className}
    />
  );
}
