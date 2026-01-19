import * as React from "react";

import { cn } from "../../lib/utils";

export const Separator = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      aria-hidden="true"
      className={cn("h-px w-full bg-border", className)}
      {...props}
    />
  )
);
Separator.displayName = "Separator";
