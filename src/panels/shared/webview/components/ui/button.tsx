import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "../../lib/utils";

const buttonVariants = cva(
  cn(
    "inline-flex items-center justify-center gap-1.5 whitespace-nowrap font-medium",
    "transition-[background-color,border-color,color,box-shadow,transform] duration-150",
    "active:translate-y-px motion-reduce:transition-none motion-reduce:active:translate-y-0"
  ),
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-xs hover:bg-primary-hover",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary-hover",
        outline:
          "border border-input bg-transparent hover:border-border-strong hover:bg-accent-soft hover:text-accent-foreground",
        ghost: "hover:bg-accent-soft hover:text-accent-foreground",
        link: "text-link underline-offset-4 hover:text-link-hover hover:underline p-0 h-auto active:translate-y-0",
        destructive:
          "bg-destructive text-destructive-foreground border border-destructive-border hover:opacity-90"
      },
      size: {
        xs: "h-6 rounded-md px-2 text-[11px]",
        sm: "h-7 rounded-md px-2.5 text-xs",
        md: "h-8 rounded-md px-3 text-sm",
        lg: "h-9 rounded-lg px-4 text-sm",
        icon: "h-8 w-8 rounded-md",
        "icon-sm": "h-6 w-6 rounded-md"
      }
    },
    defaultVariants: {
      variant: "default"
    }
  }
);

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  };
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, type, ...props }, ref) => {
    const Component = asChild ? Slot : "button";
    const componentProps = asChild ? props : { ...props, type: type ?? "button" };
    const resolvedSize = variant === "link" ? undefined : (size ?? "md");

    return (
      <Component
        ref={ref}
        className={cn(
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
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
