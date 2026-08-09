import { resolveStatusBadgeClass, type StatusVisualTone } from "../../TestStatusStyles";
import { cn } from "../lib/utils";
import { Badge } from "./ui/badge";
export function ToneBadge({
  label,
  tone,
  className
}: {
  label: string;
  tone?: StatusVisualTone;
  className?: string;
}) {
  return (
    <Badge
      variant="outline"
      size="sm"
      className={cn(tone !== undefined ? resolveStatusBadgeClass(tone) : undefined, className)}
    >
      {label}
    </Badge>
  );
}
