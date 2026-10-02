import * as React from "react";
import { ToneBadge } from "../../../../../shared/webview/components/ToneBadge";
import { Card, CardContent, CardHeader } from "../../../../../shared/webview/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from "../../../../../shared/webview/components/ui/collapsible";
import { DisclosureChevron } from "../../../../../shared/webview/components/ui/disclosure-chevron";
import type { CompareSectionStatus } from "../../../../shared/BuildCompareContracts";
import { resolveSectionStatusBadge } from "./sectionStatusBadge";

const { useId, useState } = React;

/** Lets the app control (and persist) whether a section is expanded. */
export type SectionCardDisclosureProps = {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

/**
 * Collapsible comparison section. The heading wraps only the disclosure
 * button (keeping heading navigation intact); the summary and detail sit
 * outside it and describe the button through aria-describedby. A section
 * with nothing to expand renders a compact, non-interactive heading.
 */
export function SectionCard({
  title,
  summary,
  detail,
  status,
  open: controlledOpen,
  onOpenChange,
  children
}: React.PropsWithChildren<
  {
    title: string;
    summary: string;
    detail?: string;
    status: CompareSectionStatus;
  } & SectionCardDisclosureProps
>) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(true);
  const open = controlledOpen ?? uncontrolledOpen;
  const handleOpenChange = onOpenChange ?? setUncontrolledOpen;
  const statusBadge = resolveSectionStatusBadge(status);
  const idBase = useId();
  const summaryId = `${idBase}-summary`;
  const detailId = `${idBase}-detail`;
  const describedBy = detail ? `${summaryId} ${detailId}` : summaryId;
  const hasContent = React.Children.toArray(children).length > 0;

  return (
    <Card>
      <Collapsible open={open} onOpenChange={handleOpenChange}>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold leading-tight">
                {hasContent ? (
                  // Pass classes to the trigger (not the child) so tailwind-merge
                  // overrides the shared full-width, space-between layout.
                  <CollapsibleTrigger
                    asChild
                    className="-mx-1 w-auto max-w-full justify-start rounded-md px-1 py-0.5 hover:bg-accent-soft"
                  >
                    <button type="button" aria-describedby={describedBy}>
                      <DisclosureChevron className="h-4 w-4" />
                      <span className="min-w-0 truncate" title={title}>
                        {title}
                      </span>
                    </button>
                  </CollapsibleTrigger>
                ) : (
                  // Keeps the title aligned with the summary below (chevron width + gap).
                  <span className="block pl-6">{title}</span>
                )}
              </h3>
              <p id={summaryId} className="mt-1 pl-6 text-xs leading-relaxed text-muted-foreground">
                {summary}
              </p>
              {detail ? (
                <p id={detailId} className="mt-1 pl-6 text-xs text-muted-foreground">
                  {detail}
                </p>
              ) : null}
            </div>
            {/* A populated section speaks for itself; only call out the
                states that explain missing or partial content. */}
            {status === "available" ? null : (
              <ToneBadge label={statusBadge.label} tone={statusBadge.tone} />
            )}
          </div>
        </CardHeader>
        {hasContent ? (
          <CollapsibleContent>
            <CardContent className="space-y-3">{children}</CardContent>
          </CollapsibleContent>
        ) : null}
      </Collapsible>
    </Card>
  );
}
