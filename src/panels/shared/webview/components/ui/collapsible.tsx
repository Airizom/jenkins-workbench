import * as CollapsiblePrimitive from "@radix-ui/react-collapsible";
import * as React from "react";

import {
  disclosureContentClassName,
  disclosureTriggerChildren,
  disclosureTriggerClassName
} from "./disclosure";

export const Collapsible = CollapsiblePrimitive.Root;

type CollapsibleTriggerProps = React.ComponentPropsWithoutRef<
  typeof CollapsiblePrimitive.Trigger
> & {
  asChild?: boolean;
};
export const CollapsibleTrigger = React.forwardRef<
  React.ElementRef<typeof CollapsiblePrimitive.Trigger>,
  CollapsibleTriggerProps
>(({ className, children, asChild = false, ...props }, ref) => (
  <CollapsiblePrimitive.Trigger
    ref={ref}
    asChild={asChild}
    className={disclosureTriggerClassName("w-full", className)}
    {...props}
  >
    {disclosureTriggerChildren(children, asChild)}
  </CollapsiblePrimitive.Trigger>
));
CollapsibleTrigger.displayName = "CollapsibleTrigger";

type CollapsibleContentProps = React.ComponentPropsWithoutRef<typeof CollapsiblePrimitive.Content>;
export const CollapsibleContent = React.forwardRef<
  React.ElementRef<typeof CollapsiblePrimitive.Content>,
  CollapsibleContentProps
>(({ className, children, ...props }, ref) => (
  <CollapsiblePrimitive.Content
    ref={ref}
    className={disclosureContentClassName(
      "data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down",
      className
    )}
    {...props}
  >
    {children}
  </CollapsiblePrimitive.Content>
));
CollapsibleContent.displayName = "CollapsibleContent";
