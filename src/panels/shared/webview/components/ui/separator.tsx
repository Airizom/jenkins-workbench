import * as React from "react";

import { cn } from "../../lib/utils";

type SeparatorOrientation = "horizontal" | "vertical";

export type SeparatorProps = React.HTMLAttributes<HTMLDivElement> & {
  orientation?: SeparatorOrientation;
  decorative?: boolean;
};

export const Separator = React.forwardRef<HTMLDivElement, SeparatorProps>(
  ({ className, orientation = "horizontal", decorative = true, ...props }, ref) => (
    <div
      ref={ref}
      role={decorative ? "none" : "separator"}
      aria-orientation={decorative ? undefined : orientation}
      aria-hidden={decorative}
      className={cn(
        "shrink-0 bg-border",
        orientation === "horizontal" ? "h-px w-full" : "h-full w-px",
        className
      )}
      {...props}
    />
  )
);
Separator.displayName = "Separator";
