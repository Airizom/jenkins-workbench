import { resolveResultBadgeClass } from "../lib/statusStyles";
import { cn } from "../lib/utils";
import { Badge } from "./ui/badge";

export function getResultBadgeClass(status?: string): string {
  if (!status) {
    return resolveResultBadgeClass("neutral");
  }
  return resolveResultBadgeClass(status);
}

export function ResultBadge({
  label,
  resultClass,
  status,
  className,
  id
}: {
  label: string;
  resultClass?: string;
  status?: string;
  className?: string;
  id?: string;
}) {
  const badgeClass = getResultBadgeClass(resultClass ?? status);
  return (
    <Badge id={id} variant="outline" className={cn("text-xs font-semibold", badgeClass, className)}>
      {label}
    </Badge>
  );
}
