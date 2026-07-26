import { resolveStatusBadgeClass, type StatusVisualTone } from "../../TestStatusStyles";
import { cn } from "../lib/utils";
import { Badge } from "./ui/badge";
export function ToneBadge({
  label,
  tone,
  badgeClassName,
  className
}: {
  label: string;
  tone?: StatusVisualTone;
  badgeClassName?: string;
  className?: string;
}) {
  return (
    <Badge
      variant="outline"
      size="sm"
      className={cn(
        tone !== undefined ? resolveStatusBadgeClass(tone) : undefined,
        badgeClassName,
        className
      )}
    >
      {label}
    </Badge>
  );
}
