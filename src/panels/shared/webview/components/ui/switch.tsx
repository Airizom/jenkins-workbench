import * as SwitchPrimitive from "@radix-ui/react-switch";
import * as React from "react";

import { cn } from "../../lib/utils";

export type SwitchProps = React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>;

export const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  SwitchProps
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      "peer inline-flex h-[18px] w-9 shrink-0 cursor-pointer items-center rounded-full border-2",
      "bg-muted-strong border-mutedBorder shadow-inner transition-colors",
      "data-[state=checked]:bg-primary data-[state=checked]:border-primary",
      "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
      "disabled:cursor-not-allowed disabled:opacity-50",
      className
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb
      className={cn(
        "pointer-events-none block h-3.5 w-3.5 translate-x-0.5 rounded-full transition-transform",
        "bg-muted-foreground data-[state=checked]:translate-x-[18px]",
        "data-[state=checked]:bg-primary-foreground"
      )}
    />
  </SwitchPrimitive.Root>
));
Switch.displayName = "Switch";
