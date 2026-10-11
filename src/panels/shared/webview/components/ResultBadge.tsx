import { resolveBuildResultStyle } from "../lib/statusStyles";
import { cn } from "../lib/utils";
import { Badge } from "./ui/badge";
export function getResultBadgeClass(status?: string): string {
  return resolveBuildResultStyle(status).badge;
}
export function ResultBadge({
  label,
  status,
  className,
  id
}: {
  label: string;
  status?: string;
  className?: string;
  id?: string;
}) {
  const badgeClass = getResultBadgeClass(status);
  return (
    <Badge id={id} variant="outline" className={cn("font-semibold", badgeClass, className)}>
      {label}
    </Badge>
  );
}
