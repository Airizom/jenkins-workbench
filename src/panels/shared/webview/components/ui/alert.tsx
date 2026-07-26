import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "../../lib/utils";

const alertVariants = cva(
  "relative w-full overflow-hidden rounded-lg border p-3 pl-3.5 text-sm shadow-xs before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:content-['']",
  {
    variants: {
      variant: {
        default: "border-border bg-surface text-foreground before:bg-border-strong",
        destructive: "border-inputErrorBorder bg-inputErrorBg text-inputErrorFg before:bg-failure",
        warning:
          "border-inputWarningBorder bg-inputWarningBg text-inputWarningFg before:bg-warning",
        info: "border-inputInfoBorder bg-inputInfoBg text-inputInfoFg before:bg-progress"
      }
    },
    defaultVariants: {
      variant: "default"
    }
  }
);

type AlertProps = React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>;
export const Alert = React.forwardRef<HTMLDivElement, AlertProps>(
  ({ className, variant, ...props }, ref) => (
    <div ref={ref} role="alert" className={cn(alertVariants({ variant }), className)} {...props} />
  )
);
Alert.displayName = "Alert";
export const AlertTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h5 ref={ref} className={cn("mb-1 font-semibold leading-tight", className)} {...props} />
));
AlertTitle.displayName = "AlertTitle";
export const AlertDescription = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("text-sm leading-relaxed", className)} {...props} />
));
AlertDescription.displayName = "AlertDescription";
