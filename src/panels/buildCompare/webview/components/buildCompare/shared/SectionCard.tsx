import * as React from "react";
import { ToneBadge } from "../../../../../shared/webview/components/ToneBadge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "../../../../../shared/webview/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from "../../../../../shared/webview/components/ui/collapsible";
import { DisclosureChevron } from "../../../../../shared/webview/components/ui/disclosure-chevron";
import type { CompareSectionStatus } from "../../../../shared/BuildCompareContracts";
import { resolveSectionStatusBadge } from "./sectionStatusBadge";

const { useState } = React;
export function SectionCard({
  title,
  summary,
  detail,
  status,
  children
}: React.PropsWithChildren<{
  title: string;
  summary: string;
  detail?: string;
  status: CompareSectionStatus;
}>) {
  const [open, setOpen] = useState(true);
  const statusBadge = resolveSectionStatusBadge(status);

  return (
    <Card>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="focus-ring group w-full rounded-lg text-left transition-colors hover:bg-accent-soft"
          >
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 flex-1 items-start">
                  <DisclosureChevron className="mt-0.5 h-4 w-4" />
                  <div className="min-w-0">
                    <CardTitle className="truncate">{title}</CardTitle>
                    <CardDescription>{summary}</CardDescription>
                    {detail ? (
                      <p className="mt-1.5 text-xs text-muted-foreground">{detail}</p>
                    ) : null}
                  </div>
                </div>
                <ToneBadge label={statusBadge.label} tone={statusBadge.tone} />
              </div>
            </CardHeader>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="space-y-3">{children}</CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
