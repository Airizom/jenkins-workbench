import type { ReactNode } from "react";
import { Button } from "../../../../../shared/webview/components/ui/button";
import {
  AlertCircleIcon,
  AlertTriangleIcon,
  FileIcon,
  InfoIcon
} from "../../../../../shared/webview/icons";
import type {
  BuildDiagnosticInsightItem,
  BuildDiagnosticsViewModel
} from "../../../../shared/BuildDetailsContracts";
import { BuildFailureInsightCard, BuildFailureInsightEmpty } from "./BuildFailureInsightCard";

export function BuildFailureDiagnosticsCard({
  diagnostics,
  onOpenSource,
  onShowProblems,
  onConfigure
}: {
  diagnostics: BuildDiagnosticsViewModel;
  onOpenSource: (targetId: string) => void;
  onShowProblems: () => void;
  onConfigure: () => void;
}) {
  const summary = describeBuildDiagnostics(diagnostics);
  const visibleItems = diagnostics.items.slice(0, MAX_VISIBLE_DIAGNOSTICS);
  const hiddenCount = countHiddenDiagnostics(diagnostics, visibleItems.length);
  const showProblemsDisabled = diagnostics.resolvedCount === 0;
  const showProblemsHint = showProblemsDisabled
    ? describeShowProblemsUnavailable(diagnostics.status)
    : undefined;
  return (
    <BuildFailureInsightCard
      icon={<AlertCircleIcon className="h-4 w-4 shrink-0" />}
      title="Diagnostics"
      headerExtra={
        summary.countLabel ? (
          <span className="text-caption text-muted-foreground">{summary.countLabel}</span>
        ) : undefined
      }
    >
      {diagnostics.items.some((item) => item.targetId) ? (
        <span id={OPENS_IN_EDITOR_HINT_ID} className="sr-only">
          Opens in editor
        </span>
      ) : null}
      {visibleItems.length > 0 ? (
        <ul className="space-y-1.5" aria-label="Build diagnostics">
          {visibleItems.map((item) => (
            <DiagnosticInsightRow
              item={item}
              key={diagnosticItemKey(item)}
              onOpenSource={onOpenSource}
            />
          ))}
        </ul>
      ) : (
        <BuildFailureInsightEmpty>{summary.emptyMessage}</BuildFailureInsightEmpty>
      )}

      {hiddenCount > 0 ? (
        <p className="m-0 flex flex-wrap items-center gap-x-1.5 text-caption text-muted-foreground">
          <span>+{hiddenCount.toLocaleString()} more not shown here</span>
          {showProblemsDisabled ? null : (
            <>
              <span aria-hidden="true">·</span>
              <Button
                variant="link"
                size="sm"
                className="h-auto p-0 text-caption"
                onClick={onShowProblems}
              >
                Show problems
              </Button>
            </>
          )}
        </p>
      ) : null}

      {summary.notices.length > 0 ? (
        <ul
          className="space-y-1 text-caption text-muted-foreground"
          aria-label="Diagnostic notices"
        >
          {summary.notices.map((notice) => (
            <li key={notice} className="flex items-start gap-1.5">
              <InfoIcon className="mt-0.5 h-3 w-3 shrink-0" />
              <span>{notice}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-auto flex flex-wrap gap-1.5 pt-0.5">
        <Button
          variant="secondary"
          size="sm"
          className="h-7 px-2 text-xs"
          disabled={showProblemsDisabled}
          aria-describedby={showProblemsHint ? SHOW_PROBLEMS_HINT_ID : undefined}
          title={showProblemsHint}
          onClick={onShowProblems}
        >
          Show problems
        </Button>
        <Button variant="secondary" size="sm" className="h-7 px-2 text-xs" onClick={onConfigure}>
          Configure diagnostics…
        </Button>
        {showProblemsHint ? (
          <span id={SHOW_PROBLEMS_HINT_ID} className="sr-only">
            {showProblemsHint}
          </span>
        ) : null}
      </div>
    </BuildFailureInsightCard>
  );
}

const SHOW_PROBLEMS_HINT_ID = "build-diagnostics-show-problems-hint";
// The extension already sends at most five; the cap keeps the card compact
// if that ever changes.
const MAX_VISIBLE_DIAGNOSTICS = 5;

/** Diagnostics counted in the header but not listed in the card. */
export function countHiddenDiagnostics(
  diagnostics: BuildDiagnosticsViewModel,
  visibleCount: number
): number {
  const total = diagnostics.errorCount + diagnostics.warningCount + diagnostics.informationCount;
  return Math.max(0, total - visibleCount);
}
const OPENS_IN_EDITOR_HINT_ID = "build-diagnostics-opens-in-editor";

function describeShowProblemsUnavailable(status: BuildDiagnosticsViewModel["status"]): string {
  if (status === "idle" || status === "scanning") {
    return "Available after the diagnostic scan finishes.";
  }
  if (status === "disabled") {
    return "Build diagnostics are disabled for this job.";
  }
  if (status === "needsRepository") {
    return "Choose a local repository to resolve source paths first.";
  }
  if (status === "error") {
    return "Build diagnostics could not be loaded.";
  }
  return "No diagnostics were resolved to local source files.";
}

const SEVERITY_PREFIXES: Record<BuildDiagnosticInsightItem["severity"], string> = {
  error: "Error:",
  warning: "Warning:",
  information: "Info:"
};

function DiagnosticInsightRow({
  item,
  onOpenSource
}: {
  item: BuildDiagnosticInsightItem;
  onOpenSource: (targetId: string) => void;
}) {
  const locationLine = [item.locationLabel, item.source, item.code].filter(Boolean).join(" · ");
  const content = (
    <span className="min-w-0 flex-1">
      <span className="block text-xs text-foreground wrap-break-word">
        <span className="sr-only">{SEVERITY_PREFIXES[item.severity]} </span>
        {item.message}
      </span>
      {locationLine ? (
        <span className="block text-caption text-muted-foreground break-all">{locationLine}</span>
      ) : null}
    </span>
  );
  const className =
    "flex w-full min-w-0 items-start gap-2 rounded border border-border bg-muted-soft px-2 py-1.5 text-left";
  return (
    <li className="min-w-0">
      {item.targetId ? (
        <button
          type="button"
          className={`${className} hover:border-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring`}
          aria-describedby={OPENS_IN_EDITOR_HINT_ID}
          onClick={() => onOpenSource(item.targetId as string)}
        >
          <DiagnosticSeverityIcon severity={item.severity} />
          {content}
        </button>
      ) : (
        <div className={className}>
          <DiagnosticSeverityIcon severity={item.severity} />
          {content}
        </div>
      )}
    </li>
  );
}

function DiagnosticSeverityIcon({
  severity
}: {
  severity: BuildDiagnosticInsightItem["severity"];
}): ReactNode {
  if (severity === "error") {
    return <AlertCircleIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-failure" />;
  }
  if (severity === "warning") {
    return <AlertTriangleIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />;
  }
  return <FileIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />;
}

export function describeBuildDiagnostics(diagnostics: BuildDiagnosticsViewModel): {
  countLabel?: string;
  emptyMessage: string;
  notices: string[];
} {
  const countParts = [
    diagnostics.errorCount > 0
      ? `${diagnostics.errorCount.toLocaleString()} ${pluralize("error", diagnostics.errorCount)}`
      : undefined,
    diagnostics.warningCount > 0
      ? `${diagnostics.warningCount.toLocaleString()} ${pluralize(
          "warning",
          diagnostics.warningCount
        )}`
      : undefined,
    diagnostics.informationCount > 0
      ? `${diagnostics.informationCount.toLocaleString()} info`
      : undefined
  ].filter((part): part is string => Boolean(part));

  const notices = [...diagnostics.warnings];
  if (diagnostics.status === "truncated") {
    notices.unshift("The console byte limit was reached; results may be incomplete.");
  }
  if (diagnostics.omittedCount > 0) {
    notices.push(
      `${diagnostics.omittedCount.toLocaleString()} ${pluralize(
        "problem",
        diagnostics.omittedCount
      )} omitted by the configured limit.`
    );
  }
  if (diagnostics.unresolvedCount > 0) {
    notices.push(
      `${diagnostics.unresolvedCount.toLocaleString()} source ${pluralize(
        "path",
        diagnostics.unresolvedCount
      )} could not be uniquely resolved.`
    );
  }

  return {
    countLabel: countParts.length > 0 ? countParts.join(" · ") : undefined,
    emptyMessage: diagnostics.message ?? defaultStatusMessage(diagnostics.status),
    notices: [...new Set(notices)]
  };
}

function diagnosticItemKey(item: BuildDiagnosticInsightItem): string {
  return [
    item.targetId,
    item.severity,
    item.locationLabel,
    item.source,
    item.code,
    item.message
  ].join("\u0000");
}

function defaultStatusMessage(status: BuildDiagnosticsViewModel["status"]): string {
  switch (status) {
    case "scanning":
      return "Scanning the Jenkins console for source diagnostics…";
    case "disabled":
      return "Build diagnostics are disabled for this job.";
    case "needsRepository":
      return "Choose a local repository to resolve Jenkins source paths.";
    case "error":
      return "Build diagnostics could not be loaded.";
    case "available":
    case "truncated":
      return "No local source diagnostics were found.";
    default:
      return "Waiting for a build diagnostic scan.";
  }
}

function pluralize(word: string, count: number): string {
  return count === 1 ? word : `${word}s`;
}
