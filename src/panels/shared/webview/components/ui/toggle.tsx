import * as TogglePrimitive from "@radix-ui/react-toggle";
import * as React from "react";

import { focusRingInsetClassName } from "../../lib/focus";
import { cn } from "../../lib/utils";

type ToggleProps = React.ComponentPropsWithoutRef<typeof TogglePrimitive.Root> & {
  size?: "sm" | "md";
};
export const Toggle = React.forwardRef<React.ElementRef<typeof TogglePrimitive.Root>, ToggleProps>(
  ({ className, size = "sm", ...props }, ref) => (
    <TogglePrimitive.Root
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-md border border-input bg-transparent font-medium transition-colors",
        "hover:bg-accent-soft hover:text-accent-foreground",
        focusRingInsetClassName,
        "disabled:pointer-events-none disabled:opacity-50",
        "data-[state=on]:bg-list-active data-[state=on]:text-list-activeForeground data-[state=on]:border-border",
        "data-[state=on]:hc-active-ring",
        size === "sm" ? "h-7 px-2.5 text-xs" : "h-8 px-3 text-sm",
        className
      )}
      {...props}
    />
  )
);
Toggle.displayName = "Toggle";
