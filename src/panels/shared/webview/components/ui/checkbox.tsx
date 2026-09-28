import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import * as React from "react";

import { CheckIcon, MinusIcon } from "../../icons";
import { focusRingInsetClassName } from "../../lib/focus";
import { cn } from "../../lib/utils";

type CheckboxProps = React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>;
export const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  CheckboxProps
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      "peer h-4 w-4 shrink-0 rounded-md border border-checkbox-border bg-checkbox",
      "text-checkbox-checkedForeground",
      focusRingInsetClassName,
      "disabled:cursor-not-allowed disabled:opacity-50",
      "data-[state=checked]:bg-checkbox-checked",
      "data-[state=indeterminate]:bg-checkbox-checked",
      className
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator className="group flex items-center justify-center text-current">
      <CheckIcon className="hidden h-3.5 w-3.5 group-data-[state=checked]:block" />
      <MinusIcon className="hidden h-3.5 w-3.5 group-data-[state=indeterminate]:block" />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = "Checkbox";
