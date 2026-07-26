import type * as React from "react";
import { cn } from "../lib/utils";

type SectionHeadingProps = {
  title: React.ReactNode;
  icon?: React.ReactNode;
  count?: React.ReactNode;
  actions?: React.ReactNode;
  as?: "h2" | "h3" | "h4";
  className?: string;
};

export function SectionHeading({
  title,
  icon,
  count,
  actions,
  as: Heading = "h3",
  className
}: SectionHeadingProps): React.JSX.Element {
  return (
    <div className={cn("mb-2 flex items-center justify-between gap-2", className)}>
      <Heading className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {icon}
        <span>{title}</span>
        {count !== undefined ? (
          <span className="rounded-full bg-muted-strong px-1.5 text-[10px] font-medium tabular-nums text-muted-foreground">
            {count}
          </span>
        ) : null}
      </Heading>
      {actions}
    </div>
  );
}
