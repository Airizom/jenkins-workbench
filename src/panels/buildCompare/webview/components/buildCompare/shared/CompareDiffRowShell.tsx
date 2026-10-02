import type { ReactNode } from "react";
import { cn } from "../../../../../shared/webview/lib/utils";
import { CompareMutedCard } from "./CompareMutedCard";

export type CompareDiffChangeType = "added" | "removed" | "changed" | "matched";

/** Diff badges use SCM decoration colors (styles.css), not pass/fail tones. */
const CHANGE_TYPE_BADGES: Record<
  Exclude<CompareDiffChangeType, "matched">,
  { label: string; glyph: string }
> = {
  added: { label: "Added", glyph: "+" },
  removed: { label: "Removed", glyph: "−" },
  changed: { label: "Changed", glyph: "~" }
};

export function CompareChangeBadge({
  changeType,
  label
}: {
  changeType?: CompareDiffChangeType;
  /** Overrides the default label, e.g. "New test". */
  label?: string;
}) {
  const badge = changeType && changeType !== "matched" ? CHANGE_TYPE_BADGES[changeType] : undefined;
  if (!badge) {
    return null;
  }
  return (
    <span
      data-change={changeType}
      className="bc-diff-badge inline-flex shrink-0 items-center gap-0.5 rounded-full border px-1.5 text-caption font-medium leading-4 whitespace-nowrap"
    >
      <span aria-hidden="true">{badge.glyph}</span>
      {label ?? badge.label}
    </span>
  );
}

export function CompareDiffRowShell({
  title,
  changeType,
  changeLabel,
  subtitle,
  align = "start",
  children
}: {
  title: string;
  changeType?: CompareDiffChangeType;
  changeLabel?: string;
  subtitle?: string;
  align?: "start" | "center";
  children?: ReactNode;
}) {
  const alignmentClass = align === "center" ? "items-center" : "items-start";

  return (
    <CompareMutedCard>
      <div className={cn("flex flex-wrap justify-between gap-3", alignmentClass)}>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <CompareChangeBadge changeType={changeType} label={changeLabel} />
            {/* Long test names wrap rather than truncate, so nothing hides behind a tooltip. */}
            <p className={"min-w-0 text-sm font-medium [overflow-wrap:anywhere]"}>{title}</p>
          </div>
          {subtitle ? (
            <p className="mt-1 text-xs text-muted-foreground [overflow-wrap:anywhere]">
              {subtitle}
            </p>
          ) : null}
        </div>
        {children}
      </div>
    </CompareMutedCard>
  );
}
