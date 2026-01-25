import * as React from "react";

import { cn } from "../../lib/utils";

export interface ScrollAreaProps extends React.HTMLAttributes<HTMLDivElement> {
  orientation?: "vertical" | "horizontal" | "both";
}

export const ScrollArea = React.forwardRef<HTMLDivElement, ScrollAreaProps>(
  ({ className, orientation = "vertical", children, ...props }, ref) => {
    const overflowClasses = {
      vertical: "overflow-y-auto overflow-x-hidden",
      horizontal: "overflow-x-auto overflow-y-hidden",
      both: "overflow-auto"
    };

    return (
      <div ref={ref} className={cn("relative", overflowClasses[orientation], className)} {...props}>
        {children}
      </div>
    );
  }
);
ScrollArea.displayName = "ScrollArea";
