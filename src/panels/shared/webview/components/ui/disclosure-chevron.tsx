import { ChevronDownIcon } from "../../icons";
import { cn } from "../../lib/utils";

export function DisclosureChevron({ className }: { className?: string }) {
  return (
    <ChevronDownIcon
      className={cn(
        "mr-2 shrink-0 text-muted-foreground transition-transform duration-200",
        "group-data-[state=open]:rotate-180",
        "group-data-[state=open]:text-foreground",
        className
      )}
    />
  );
}
