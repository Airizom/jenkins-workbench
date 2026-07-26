import { resolveSeverityBadgeClass } from "../lib/statusStyles";
import { ToneBadge } from "./ToneBadge";
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
    <ToneBadge
      label={label}
      badgeClassName={resolveSeverityBadgeClass(severity)}
      className={className}
    />
  );
}
