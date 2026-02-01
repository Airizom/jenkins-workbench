import type * as React from "react";

import { cn } from "../../lib/utils";

type BadgeVariant = "default" | "secondary" | "outline" | "muted";

const badgeVariants: Record<BadgeVariant, string> = {
  default: "border-transparent bg-badge text-badge-foreground",
  secondary: "border-transparent bg-secondary text-secondary-foreground",
  outline: "border-border bg-transparent text-foreground",
  muted: "border-transparent bg-muted text-muted-foreground"
};

export type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & {
  variant?: BadgeVariant;
};

export function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium leading-4",
        badgeVariants[variant],
        className
      )}
      {...props}
    />
  );
}
