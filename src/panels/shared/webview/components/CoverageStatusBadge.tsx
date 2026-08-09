import { resolveCoverageStatusBadgeClass } from "../../TestStatusStyles";
import { cn } from "../lib/utils";
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
      className={cn(resolveCoverageStatusBadgeClass(statusClass), className)}
    />
  );
}
