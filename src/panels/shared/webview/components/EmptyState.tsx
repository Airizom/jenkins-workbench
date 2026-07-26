import type * as React from "react";
import { cn } from "../lib/utils";

type EmptyStateProps = {
  title: string;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  /** `card` sits inside an existing surface; `plain` is for already-bordered containers. */
  variant?: "card" | "plain";
  tone?: "neutral" | "warning" | "failure";
  className?: string;
};

type EmptyStateTone = NonNullable<EmptyStateProps["tone"]>;

const TONE_STYLES: Record<EmptyStateTone, { container: string; icon: string }> = {
  neutral: {
    container: "border-border bg-surface-sunken",
    icon: "text-muted-foreground"
  },
  warning: {
    container: "border-warning-border bg-warning-soft",
    icon: "text-warning"
  },
  failure: {
    container: "border-failure-border bg-failure-soft",
    icon: "text-failure"
  }
};

export function EmptyState({
  title,
  description,
  icon,
  action,
  variant = "card",
  tone = "neutral",
  className
}: EmptyStateProps): React.JSX.Element {
  const toneStyles = TONE_STYLES[tone];

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 px-4 py-8 text-center",
        variant === "card" && cn("rounded-lg border border-dashed", toneStyles.container),
        className
      )}
    >
      {icon ? (
        <div
          aria-hidden="true"
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-full border border-border bg-surface",
            toneStyles.icon
          )}
        >
          {icon}
        </div>
      ) : null}
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description ? (
        <p className="max-w-prose text-xs leading-relaxed text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
