import * as React from "react";
import {
  resolveBuildResultClass,
  resolveBuildResultLabel
} from "../../../formatters/BuildStatusFormatters";
import type { HistoryOutcome, TestHistory } from "../../../history/HistoryAnalysis";
import { resolveStatusBadgeClass } from "../../shared/TestStatusStyles";
import { BuildResultStatusIcon } from "../../shared/webview/components/BuildResultStatusIcon";
import { TestStatusIcon } from "../../shared/webview/components/TestStatusIcon";
import { Badge } from "../../shared/webview/components/ui/badge";
import { Button } from "../../shared/webview/components/ui/button";
import { AlertCircleIcon, MinusIcon } from "../../shared/webview/icons";
import { resolveResultIconTextClass } from "../../shared/webview/lib/statusStyles";
import { cn } from "../../shared/webview/lib/utils";
import { postVsCodeMessage } from "../../shared/webview/lib/vscodeApi";
import type { HistoryAction, HistoryViewModel } from "../shared/HistoryContracts";
import { compareBuildsLabel, outcomePresentation } from "./historyPresentation";

function OutcomeIcon({ outcome }: { outcome: HistoryOutcome | undefined }) {
  switch (outcome) {
    case "passed":
    case "failed":
    case "skipped":
      return <TestStatusIcon status={outcome} size={12} />;
    case "ambiguous":
      return <AlertCircleIcon aria-hidden="true" className="h-3 w-3 shrink-0" />;
    case "unknown":
      return <TestStatusIcon status="other" size={12} />;
    default:
      return <MinusIcon aria-hidden="true" className="h-3 w-3 shrink-0" />;
  }
}

/** Test outcome with icon and tone; evidence gaps get a dashed neutral badge and an explanation. */
export function OutcomeBadge({
  outcome,
  className
}: {
  outcome: HistoryOutcome | undefined;
  className?: string;
}) {
  const presentation = outcomePresentation(outcome);
  return (
    <Badge
      variant="outline"
      size="sm"
      title={presentation.tooltip}
      className={cn(
        resolveStatusBadgeClass(presentation.tone),
        presentation.gap && "border-dashed border-muted-foreground-border bg-transparent",
        className
      )}
    >
      <OutcomeIcon outcome={outcome} />
      {presentation.label}
      {presentation.tooltip ? <span className="sr-only">. {presentation.tooltip}</span> : null}
    </Badge>
  );
}

/** Marks the analyzed build: "This build" inside Build Details, "Selected" in Job History. */
export function SelectedBuildBadge({ label = "This build" }: { label?: string }) {
  return (
    <Badge variant="muted" size="sm">
      {label}
    </Badge>
  );
}

export function BuildResultLabel({ result, building }: { result?: string; building?: boolean }) {
  const resultClass = resolveBuildResultClass(result, building);
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span
        className={cn("inline-flex", resolveResultIconTextClass(resultClass))}
        aria-hidden="true"
      >
        <BuildResultStatusIcon status={resultClass} className="h-3.5 w-3.5" />
      </span>
      {resolveBuildResultLabel(result, building)}
    </span>
  );
}

/**
 * Per-build outcomes for one test, newest first. Self-contained so it renders the same inside
 * Job History and inside Build Details test rows.
 */
export function TestOutcomeTimeline({
  model,
  test,
  onOpenBuild,
  onCompare,
  selectedLabel
}: {
  model: HistoryViewModel;
  test: TestHistory;
  onOpenBuild: (buildNumber: number) => void;
  onCompare?: (buildNumber: number) => void;
  selectedLabel?: string;
}) {
  return (
    <ol className="flex flex-col divide-y divide-border rounded-md border border-border bg-surface">
      {model.builds.map(({ build }, index) => {
        const isSelected = build.number === model.selectedBuild;
        return (
          <li
            key={build.number}
            className={cn(
              "flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1",
              isSelected && "bg-accent-soft"
            )}
          >
            <Button
              variant="link"
              className="min-w-10 justify-start text-xs tabular-nums"
              aria-label={`Open build #${build.number} details`}
              onClick={() => onOpenBuild(build.number)}
            >
              #{build.number}
            </Button>
            <OutcomeBadge outcome={test.outcomes[index]} />
            {isSelected ? <SelectedBuildBadge label={selectedLabel} /> : null}
            {onCompare && !isSelected && model.selectedBuild !== undefined ? (
              <Button
                variant="ghost"
                size="xs"
                className="ml-auto"
                aria-label={compareBuildsLabel(build.number, model.selectedBuild)}
                onClick={() => onCompare(build.number)}
              >
                Compare with #{model.selectedBuild}
              </Button>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

export type HistorySend = (
  action: Exclude<HistoryAction["action"], "ready">,
  value?: number
) => void;

export function useHistoryAction(model: HistoryViewModel): HistorySend {
  const revision = model.revision;
  return React.useCallback<HistorySend>(
    (action, value) =>
      postVsCodeMessage({ type: "historyAction", revision, action, value } satisfies HistoryAction),
    [revision]
  );
}
