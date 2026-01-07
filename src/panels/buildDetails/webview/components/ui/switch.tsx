import * as React from "react";

import { cn } from "../../lib/utils";

export type SwitchProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">;

export const Switch = React.forwardRef<HTMLInputElement, SwitchProps>(
  ({ className, ...props }, ref) => (
    <span className={cn("relative inline-flex h-5 w-9 shrink-0", className)}>
      <input
        ref={ref}
        type="checkbox"
        className="peer absolute inset-0 m-0 h-full w-full cursor-pointer opacity-0"
        {...props}
      />
      <span className="h-5 w-9 rounded-full bg-muted transition-colors peer-checked:bg-primary" />
      <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-background transition-transform peer-checked:translate-x-4" />
    </span>
  )
);
Switch.displayName = "Switch";
