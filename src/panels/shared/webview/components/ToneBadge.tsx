import { type StatusVisualTone, resolveStatusBadgeClass } from "../../TestStatusStyles";
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
      className={cn(
        "text-[10px] px-1.5 py-0",
        tone !== undefined ? resolveStatusBadgeClass(tone) : undefined,
        badgeClassName,
        className
      )}
    >
      {label}
    </Badge>
  );
}
