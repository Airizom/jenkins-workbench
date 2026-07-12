import * as ProgressPrimitive from "@radix-ui/react-progress";
import * as React from "react";

import { cn } from "../../lib/utils";

interface ProgressProps
  extends Omit<React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root>, "value" | "max"> {
  value?: number;
  max?: number;
  indeterminate?: boolean;
}

function normalizeProgressMax(max: number): number {
  return Number.isFinite(max) && max > 0 ? max : 100;
}

export const Progress = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  ProgressProps
>(({ className, value = 0, max = 100, indeterminate = false, ...props }, ref) => {
  const safeMax = normalizeProgressMax(max);
  const percentage = Math.min(100, Math.max(0, (value / safeMax) * 100));

  return (
    <ProgressPrimitive.Root
      ref={ref}
      className={cn("relative h-2 w-full overflow-hidden rounded-full bg-muted", className)}
      value={indeterminate ? undefined : value}
      max={indeterminate ? undefined : safeMax}
      {...props}
    >
      <ProgressPrimitive.Indicator
        className={cn(
          "h-full rounded-full bg-progress transition-all duration-300",
          indeterminate && "animate-progress-indeterminate w-1/3"
        )}
        style={indeterminate ? undefined : { transform: `translateX(-${100 - percentage}%)` }}
      />
    </ProgressPrimitive.Root>
  );
});
Progress.displayName = "Progress";
