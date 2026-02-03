import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "../../lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-colors",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary-hover",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary-hover",
        outline:
          "border border-input bg-transparent hover:bg-accent-soft hover:text-accent-foreground",
        ghost: "hover:bg-accent-soft hover:text-accent-foreground",
        link: "text-link underline-offset-4 hover:text-link-hover hover:underline p-0 h-auto",
        destructive:
          "bg-destructive text-destructive-foreground border border-destructive-border hover:opacity-90"
      },
      size: {
        sm: "h-7 rounded px-2.5 text-xs",
        md: "h-8 rounded px-3 text-sm",
        lg: "h-9 rounded px-4 text-sm",
        icon: "h-8 w-8 rounded"
      }
    },
    defaultVariants: {
      variant: "default"
    }
  }
);

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  };

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, type, ...props }, ref) => {
    const Component = asChild ? Slot : "button";
    const componentProps = asChild
      ? props
      : { ...props, type: type ?? "button" };
    const resolvedSize = variant === "link" ? undefined : (size ?? "md");

    return (
      <Component
        ref={ref}
        className={cn(
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          "disabled:pointer-events-none disabled:opacity-50",
          buttonVariants({ variant, size: resolvedSize }),
          className
        )}
        {...componentProps}
      />
    );
  }
);
Button.displayName = "Button";
