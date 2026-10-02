import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "../../lib/utils";

const badgeVariants = cva(
  // `min-w-0 max-w-full` stop a long label from widening its container. Labels
  // stay on one line by default; pass `whitespace-normal break-all` to wrap, or
  // wrap the text in `TruncatedText` to ellipsize it with a `title`.
  "inline-flex min-w-0 max-w-full items-center gap-1 rounded-full border font-medium whitespace-nowrap",
  {
    variants: {
      variant: {
        // Filled variants carry `border-hc-border`, which is transparent except in
        // high-contrast themes, where the fill alone is not a visible boundary.
        default: "border-hc-border bg-badge text-badge-foreground",
        secondary: "border-hc-border bg-secondary text-secondary-foreground",
        outline: "border-border bg-transparent text-foreground",
        muted: "border-hc-border bg-muted-strong text-muted-foreground",
        // Text uses the `*-foreground` tokens: the raw status colors fall below
        // 4.5:1 on their own 10% tint in light themes.
        success: "border-success-border bg-success-soft text-success-foreground",
        warning: "border-warning-border bg-warning-soft text-warning-foreground",
        failure: "border-failure-border bg-failure-soft text-failure-foreground",
        info: "border-info-border bg-info-soft text-info-foreground"
      },
      size: {
        // `leading-4` follows the font size: tailwind-merge drops a line height
        // that precedes a font-size class.
        default: "px-2.5 py-0.5 text-xs leading-4",
        sm: "px-1.5 py-0 text-caption leading-4"
      }
    },
    defaultVariants: {
      variant: "default",
      size: "default"
    }
  }
);

export type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>;
export function Badge({ className, variant, size, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant, size }), className)} {...props} />;
}
