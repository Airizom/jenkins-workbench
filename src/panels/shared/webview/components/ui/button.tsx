import * as React from "react";

import { cn } from "../../lib/utils";

type ButtonVariant = "default" | "secondary" | "outline" | "ghost" | "link" | "destructive";

type ButtonSize = "sm" | "md" | "lg" | "icon";

const buttonVariants: Record<ButtonVariant, string> = {
  default: "bg-primary text-primary-foreground hover:bg-primary-hover",
  secondary: "bg-secondary text-secondary-foreground hover:bg-secondary-hover",
  outline: "border border-input bg-transparent hover:bg-accent hover:text-accent-foreground",
  ghost: "hover:bg-accent hover:text-accent-foreground",
  link: "text-link underline-offset-4 hover:text-link-hover hover:underline p-0 h-auto",
  destructive: "bg-destructive text-destructive-foreground border border-destructive-border hover:opacity-90"
};

const buttonSizes: Record<ButtonSize, string> = {
  sm: "h-7 rounded px-2.5 text-xs",
  md: "h-8 rounded px-3 text-sm",
  lg: "h-9 rounded px-4 text-sm",
  icon: "h-8 w-8 rounded"
};

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "md", type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        "disabled:pointer-events-none disabled:opacity-50",
        buttonVariants[variant],
        variant !== "link" && buttonSizes[size],
        className
      )}
      {...props}
    />
  )
);
Button.displayName = "Button";
