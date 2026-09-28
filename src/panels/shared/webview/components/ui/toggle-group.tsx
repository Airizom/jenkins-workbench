import * as ToggleGroupPrimitive from "@radix-ui/react-toggle-group";
import * as React from "react";

import { focusRingInsetClassName } from "../../lib/focus";
import { cn } from "../../lib/utils";

type ToggleGroupProps = React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Root>;
export const ToggleGroup = React.forwardRef<
  React.ElementRef<typeof ToggleGroupPrimitive.Root>,
  ToggleGroupProps
>(({ className, ...props }, ref) => (
  <ToggleGroupPrimitive.Root
    ref={ref}
    className={cn(
      "inline-flex items-center gap-1 rounded-md border border-border bg-muted-soft p-1",
      className
    )}
    {...props}
  />
));
ToggleGroup.displayName = "ToggleGroup";

type ToggleGroupItemProps = React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Item>;
export const ToggleGroupItem = React.forwardRef<
  React.ElementRef<typeof ToggleGroupPrimitive.Item>,
  ToggleGroupItemProps
>(({ className, ...props }, ref) => (
  <ToggleGroupPrimitive.Item
    ref={ref}
    className={cn(
      "inline-flex h-7 items-center justify-center rounded-md px-2.5 text-xs font-medium transition-colors",
      "hover:bg-accent-soft hover:text-accent-foreground",
      focusRingInsetClassName,
      "disabled:pointer-events-none disabled:opacity-50",
      "data-[state=on]:bg-list-active data-[state=on]:text-list-activeForeground data-[state=on]:hc-active-ring",
      className
    )}
    {...props}
  />
));
ToggleGroupItem.displayName = "ToggleGroupItem";
