import * as React from "react";
import { Badge } from "../../../../../shared/webview/components/ui/badge";
import { Button } from "../../../../../shared/webview/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from "../../../../../shared/webview/components/ui/collapsible";
import {
  AlertCircleIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  ClockIcon,
  FileIcon,
  TestTubeIcon,
  XCircleIcon
} from "../../../../../shared/webview/icons";
import { cn } from "../../../../../shared/webview/lib/utils";
import type {
  BuildTestCaseViewModel,
  TestResultStatus
} from "../../../../shared/BuildDetailsContracts";
import { hasTestDetails, statusBorderClass } from "./testResultsUtils";

const { useState } = React;

const STATUS_ICON_STYLE = { width: 14, height: 14 };

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
  const borderClass = statusBorderClass(item.status);

  const content = (
    <>
      <StatusGlyph status={item.status} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-foreground">{item.name}</div>
        <div className="truncate text-xs text-muted-foreground">
          {[item.className, item.suiteName].filter(Boolean).join(" \u2022 ") || "Unnamed suite"}
        </div>
      </div>
      <StatusBadge status={item.status} label={item.statusLabel} />
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
            <DetailBlock label="Failure" value={item.errorDetails} tone="failure" />
          ) : null}
          {item.errorStackTrace ? (
            <DetailBlock label="Stack Trace" value={item.errorStackTrace} tone="failure" />
          ) : null}
          {item.stdout ? <DetailBlock label="Stdout" value={item.stdout} /> : null}
          {item.stderr ? <DetailBlock label="Stderr" value={item.stderr} tone="warning" /> : null}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function DetailBlock({
  label,
  value,
  tone
}: {
  label: string;
  value: string;
  tone?: "failure" | "warning";
}) {
  return (
    <div
      className={cn(
        "rounded border border-border bg-background",
        tone === "failure" && "border-l-2 border-l-failure",
        tone === "warning" && "border-l-2 border-l-warning"
      )}
    >
      <div className="border-b border-border px-2.5 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <pre className="m-0 max-h-52 overflow-auto px-2.5 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap wrap-break-word">
        {value}
      </pre>
    </div>
  );
}

function StatusGlyph({ status }: { status: BuildTestCaseViewModel["status"] }) {
  switch (status) {
    case "passed":
      return <CheckCircleIcon className="shrink-0 text-success" style={STATUS_ICON_STYLE} />;
    case "skipped":
      return <AlertCircleIcon className="shrink-0 text-warning" style={STATUS_ICON_STYLE} />;
    case "failed":
      return <XCircleIcon className="shrink-0 text-failure" style={STATUS_ICON_STYLE} />;
    default:
      return <TestTubeIcon className="shrink-0 text-muted-foreground" style={STATUS_ICON_STYLE} />;
  }
}

function StatusBadge({ status, label }: { status: TestResultStatus; label: string }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "text-[10px] px-1.5 py-0",
        status === "failed" && "border-failure-border-subtle text-failure",
        status === "passed" && "border-success-border text-success",
        status === "skipped" && "border-warning-border text-warning",
        status === "other" && "border-border text-muted-foreground"
      )}
    >
      {label}
    </Badge>
  );
}
