import type { ReactNode } from "react";
import { CompareMutedCard } from "./CompareMutedCard";
export function CompareDiffRowShell({
  title,
  changeType,
  subtitle,
  titleClassName,
  align = "start",
  children
}: {
  title: string;
  changeType?: string;
  subtitle?: string;
  titleClassName?: string;
  align?: "start" | "center";
  children?: ReactNode;
}) {
  const secondaryLine = subtitle ?? changeType;
  const alignmentClass = align === "center" ? "items-center" : "items-start";

  return (
    <CompareMutedCard>
      <div className={`flex flex-wrap ${alignmentClass} justify-between gap-3`}>
        <div className="min-w-0">
          <p className={`text-sm font-medium ${titleClassName ?? ""}`.trim()}>{title}</p>
          {secondaryLine ? (
            <p
              className={`mt-1 text-xs text-muted-foreground ${subtitle ? "truncate" : "capitalize"}`.trim()}
            >
              {secondaryLine}
            </p>
          ) : null}
        </div>
        {children}
      </div>
    </CompareMutedCard>
  );
}
