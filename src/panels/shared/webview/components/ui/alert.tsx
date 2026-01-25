import * as React from "react";

import { cn } from "../../lib/utils";

type AlertVariant = "default" | "destructive" | "warning" | "info";

const alertVariants: Record<AlertVariant, string> = {
  default: "border-border bg-muted text-foreground",
  destructive: "border-inputErrorBorder bg-inputErrorBg text-inputErrorFg",
  warning: "border-inputWarningBorder bg-inputWarningBg text-inputWarningFg",
  info: "border-ring bg-muted text-foreground"
};

export type AlertProps = React.HTMLAttributes<HTMLDivElement> & {
  variant?: AlertVariant;
};

export const Alert = React.forwardRef<HTMLDivElement, AlertProps>(
  ({ className, variant = "default", ...props }, ref) => (
    <div
      ref={ref}
      role="alert"
      className={cn(
        "relative w-full rounded border p-3 text-sm",
        alertVariants[variant],
        className
      )}
      {...props}
    />
  )
);
Alert.displayName = "Alert";

export const AlertTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h5 ref={ref} className={cn("mb-1 font-semibold leading-tight", className)} {...props} />
));
AlertTitle.displayName = "AlertTitle";

export const AlertDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("text-sm leading-relaxed", className)} {...props} />
));
AlertDescription.displayName = "AlertDescription";
