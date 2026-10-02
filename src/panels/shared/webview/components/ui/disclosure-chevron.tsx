import { ChevronRightIcon } from "../../icons";
import { cn } from "../../lib/utils";

/**
 * VS Code disclosure convention: chevron-right when collapsed, rotated to
 * point down when the enclosing `group` is open.
 */
export function DisclosureChevron({ className }: { className?: string }) {
  return (
    <ChevronRightIcon
      className={cn(
        "mr-2 shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none",
        "group-data-[state=open]:rotate-90",
        "group-data-[state=open]:text-foreground",
        className
      )}
    />
  );
}
