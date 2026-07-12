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
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <CardTitle>
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="group flex min-w-0 items-center justify-start text-left"
                  >
                    <DisclosureChevron className="h-4 w-4" />
                    <span className="min-w-0 truncate">{title}</span>
                  </button>
                </CollapsibleTrigger>
              </CardTitle>
              <CardDescription className="pl-6">{summary}</CardDescription>
              {detail ? <p className="mt-2 pl-6 text-xs text-muted-foreground">{detail}</p> : null}
            </div>
            <ToneBadge label={statusBadge.label} tone={statusBadge.tone} />
          </div>
        </CardHeader>
        <CollapsibleContent>
          <CardContent className="space-y-3">{children}</CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
