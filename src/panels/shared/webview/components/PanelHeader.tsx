import type * as React from "react";
import { cn } from "../lib/utils";

type PanelHeaderProps = {
  /** Small context line above the title, e.g. the Jenkins environment. */
  eyebrow?: React.ReactNode;
  eyebrowIcon?: React.ReactNode;
  title: React.ReactNode;
  /** Badges rendered inline after the title. */
  titleAdornment?: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  /** Constrains the header content to the same width as the panel body. */
  maxWidthClassName?: string;
  className?: string;
};

export function PanelHeader({
  eyebrow,
  eyebrowIcon,
  title,
  titleAdornment,
  meta,
  actions,
  maxWidthClassName = "max-w-6xl",
  className
}: PanelHeaderProps): React.JSX.Element {
  return (
    <header className={cn("panel-header", className)}>
      <div
        className={cn(
          "mx-auto flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3",
          maxWidthClassName
        )}
      >
        <div className="min-w-0 flex-1">
          {eyebrow ? (
            <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {eyebrowIcon}
              <span className="truncate">{eyebrow}</span>
            </div>
          ) : null}
          <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-2">
            <h1 className="min-w-0 truncate text-base font-semibold leading-tight sm:text-lg">
              {title}
            </h1>
            {titleAdornment}
          </div>
        </div>
        {meta || actions ? (
          <div className="flex shrink-0 items-center gap-2">
            {meta ? <span className="text-xs text-muted-foreground">{meta}</span> : null}
            {actions}
          </div>
        ) : null}
      </div>
    </header>
  );
}
