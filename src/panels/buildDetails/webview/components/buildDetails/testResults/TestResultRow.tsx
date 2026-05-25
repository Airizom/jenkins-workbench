import * as React from "react";
import { formatTestCaseSubtitle } from "../../../../../shared/TestCaseViewModel";
import { testStatusToVisualTone } from "../../../../../shared/TestStatusFormatters";
import { resolveStatusBorderClass } from "../../../../../shared/TestStatusStyles";
import { TestDetailBlock } from "../../../../../shared/webview/components/TestDetailBlock";
import { TestStatusBadge } from "../../../../../shared/webview/components/TestStatusBadge";
import { TestStatusIcon } from "../../../../../shared/webview/components/TestStatusIcon";
import { Button } from "../../../../../shared/webview/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from "../../../../../shared/webview/components/ui/collapsible";
import { ChevronDownIcon, ClockIcon, FileIcon } from "../../../../../shared/webview/icons";
import { cn } from "../../../../../shared/webview/lib/utils";
import type { BuildTestCaseViewModel } from "../../../../shared/BuildDetailsContracts";
import { hasTestDetails } from "./testResultsUtils";

const { useState } = React;

export function TestResultRow({
  item,
  initialOpen,
  onOpenSource
}: {
  item: BuildTestCaseViewModel;
  initialOpen?: boolean;
  onOpenSource: (testCase: BuildTestCaseViewModel) => void;
}) {
  const [open, setOpen] = useState(initialOpen ?? false);
  const hasDetails = hasTestDetails(item);
  const borderClass = resolveStatusBorderClass(testStatusToVisualTone(item.status));

  const content = (
    <>
      <TestStatusIcon status={item.status} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-foreground">{item.name}</div>
        <div className="truncate text-xs text-muted-foreground">
          {formatTestCaseSubtitle(item.className, item.suiteName)}
        </div>
      </div>
      <TestStatusBadge status={item.status} label={item.statusLabel} />
      {item.durationLabel ? (
        <span className="hidden items-center gap-1 text-xs text-muted-foreground sm:inline-flex">
          <ClockIcon className="h-3.5 w-3.5" />
          {item.durationLabel}
        </span>
      ) : null}
      {hasDetails ? (
        <ChevronDownIcon
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
            open ? "rotate-180" : ""
          )}
        />
      ) : null}
    </>
  );

  if (!hasDetails) {
    return (
      <div className={cn("flex items-center gap-3 px-3 py-2", borderClass)}>
        <div className="flex min-w-0 flex-1 items-center gap-3">{content}</div>
        {item.canOpenSource ? (
          <Button variant="ghost" size="sm" onClick={() => onOpenSource(item)}>
            <FileIcon className="h-3.5 w-3.5" />
            Source
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen} className={cn("group", borderClass)}>
      <div className="flex items-center gap-3 px-3 py-2">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-3 text-left hover:text-foreground"
          >
            {content}
          </button>
        </CollapsibleTrigger>
        {item.canOpenSource ? (
          <Button variant="ghost" size="sm" onClick={() => onOpenSource(item)}>
            <FileIcon className="h-3.5 w-3.5" />
            Source
          </Button>
        ) : null}
      </div>
      <CollapsibleContent className="border-t border-border bg-muted-soft px-3 py-3">
        <div className="space-y-2">
          {item.errorDetails ? (
            <TestDetailBlock label="Failure" value={item.errorDetails} tone="failed" />
          ) : null}
          {item.errorStackTrace ? (
            <TestDetailBlock label="Stack Trace" value={item.errorStackTrace} tone="failed" />
          ) : null}
          {item.stdout ? <TestDetailBlock label="Stdout" value={item.stdout} /> : null}
          {item.stderr ? (
            <TestDetailBlock label="Stderr" value={item.stderr} tone="skipped" />
          ) : null}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
