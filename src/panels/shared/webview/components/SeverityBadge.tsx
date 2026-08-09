import { resolveSeverityBadgeClass } from "../lib/statusStyles";
import { cn } from "../lib/utils";
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
  return <ToneBadge label={label} className={cn(resolveSeverityBadgeClass(severity), className)} />;
}
