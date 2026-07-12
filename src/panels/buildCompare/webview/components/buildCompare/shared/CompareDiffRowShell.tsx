import type { ReactNode } from "react";
import type { StatusVisualTone } from "../../../../../shared/TestStatusStyles";
import { ToneBadge } from "../../../../../shared/webview/components/ToneBadge";
import { CompareMutedCard } from "./CompareMutedCard";

export type CompareDiffChangeType = "added" | "removed" | "changed" | "matched";

const CHANGE_TYPE_BADGES: Record<
  Exclude<CompareDiffChangeType, "matched">,
  { label: string; tone: StatusVisualTone }
> = {
  added: { label: "Added", tone: "passed" },
  removed: { label: "Removed", tone: "failed" },
  changed: { label: "Changed", tone: "skipped" }
};
export function CompareDiffRowShell({
  title,
  changeType,
  subtitle,
  titleClassName,
  align = "start",
  children
}: {
  title: string;
  changeType?: CompareDiffChangeType;
  subtitle?: string;
  titleClassName?: string;
  align?: "start" | "center";
  children?: ReactNode;
}) {
  const badge = changeType && changeType !== "matched" ? CHANGE_TYPE_BADGES[changeType] : undefined;
  const alignmentClass = align === "center" ? "items-center" : "items-start";

  return (
    <CompareMutedCard>
      <div className={`flex flex-wrap ${alignmentClass} justify-between gap-3`}>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            {badge ? <ToneBadge label={badge.label} tone={badge.tone} /> : null}
            <p className={`min-w-0 text-sm font-medium ${titleClassName ?? ""}`.trim()}>{title}</p>
          </div>
          {subtitle ? (
            <p className="mt-1 truncate text-xs text-muted-foreground">{subtitle}</p>
          ) : null}
        </div>
        {children}
      </div>
    </CompareMutedCard>
  );
}
