import * as React from "react";

import { cn } from "../../lib/utils";

export type SwitchProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">;

export const Switch = React.forwardRef<HTMLInputElement, SwitchProps>(
  ({ className, ...props }, ref) => (
    <span className={cn("relative inline-flex h-[18px] w-9 shrink-0", className)}>
      <input
        ref={ref}
        type="checkbox"
        className="peer absolute inset-0 m-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
        {...props}
      />
      <span
        className={cn(
          "h-[18px] w-9 rounded-full border-2 transition-colors",
          "bg-muted-strong border-mutedBorder shadow-inner",
          "peer-checked:bg-primary peer-checked:border-primary",
          "peer-focus-visible:ring-1 peer-focus-visible:ring-ring",
          "peer-disabled:opacity-50"
        )}
      />
      <span
        className={cn(
          "pointer-events-none absolute left-0.5 top-0.5 h-3.5 w-3.5 rounded-full transition-transform",
          "bg-muted-foreground peer-checked:bg-primary-foreground",
          "peer-checked:translate-x-[18px]"
        )}
      />
    </span>
  )
);
Switch.displayName = "Switch";
