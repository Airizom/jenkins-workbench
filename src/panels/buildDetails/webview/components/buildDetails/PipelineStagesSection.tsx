import * as React from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { Button } from "../../../../shared/webview/components/ui/button";
import { Card, CardContent } from "../../../../shared/webview/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from "../../../../shared/webview/components/ui/collapsible";
import { Skeleton } from "../../../../shared/webview/components/ui/skeleton";
import { cn } from "../../../../shared/webview/lib/utils";
import type {
  PipelineStageStepViewModel,
  PipelineStageViewModel
} from "../../../shared/BuildDetailsContracts";
import { StatusPill, getStatusClass } from "./StatusPill";

const { useEffect, useMemo, useState } = React;

function CheckIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2.5"
      viewBox="0 0 24 24"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2.5"
      viewBox="0 0 24 24"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4 ml-0.5"
      fill="currentColor"
      viewBox="0 0 24 24"
    >
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2.5"
      viewBox="0 0 24 24"
    >
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
      <rect x="6" y="6" width="12" height="12" rx="1" />
    </svg>
  );
}

function getStageIcon(statusClass?: string) {
  switch (statusClass) {
    case "success":
      return <CheckIcon />;
    case "failure":
      return <XIcon />;
    case "unstable":
      return <AlertIcon />;
    case "running":
      return <PlayIcon />;
    case "aborted":
      return <StopIcon />;
    default:
      return null;
  }
}

function getStageNodeStyle(statusClass?: string): string {
  const baseStyles =
    "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 shadow-sm transition-colors";
  switch (statusClass) {
    case "success":
      return cn(baseStyles, "border-success-border bg-success-soft text-success");
    case "failure":
      return cn(baseStyles, "border-failure-border bg-failure-soft text-failure");
    case "unstable":
      return cn(baseStyles, "border-warning-border bg-warning-soft text-warning");
    case "running":
      return cn(baseStyles, "border-warning-border bg-warning-soft text-warning animate-pulse");
    case "aborted":
      return cn(baseStyles, "border-aborted-border bg-aborted-soft text-aborted");
    default:
      return cn(baseStyles, "border-border bg-muted text-muted-foreground");
  }
}

function getConnectorColor(statusClass?: string): string {
  switch (statusClass) {
    case "success":
      return "var(--success)";
    case "failure":
      return "var(--failure)";
    case "unstable":
      return "var(--warning)";
    case "running":
      return "var(--warning)";
    case "aborted":
      return "var(--aborted)";
    default:
      return "var(--border)";
  }
}

export function PipelineStagesSection({
  stages,
  loading
}: {
  stages: PipelineStageViewModel[];
  loading: boolean;
}) {
  const [expandedStages, setExpandedStages] = useState<Record<string, boolean>>({});
  const [showAllStages, setShowAllStages] = useState<Record<string, boolean>>({});

  const stageKeys = useMemo(() => collectStageKeys(stages), [stages]);
  const hasStages = stages.length > 0;
  const showPlaceholder = loading && !hasStages;

  useEffect(() => {
    setExpandedStages((prev) => pruneStageState(prev, stageKeys));
    setShowAllStages((prev) => pruneStageState(prev, stageKeys));
  }, [stageKeys]);

  if (!loading && !hasStages) {
    return null;
  }

  return (
    <div id="pipeline-section" aria-busy={loading}>
      {loading && hasStages ? <LoadingBanner /> : null}
      {showPlaceholder ? (
        <PipelineStagesPlaceholder />
      ) : (
        <div className="space-y-0">
          {stages.map((stage, index) => {
            const stageKey = typeof stage.key === "string" ? stage.key : "";
            const expanded = expandedStages[stageKey] ?? false;
            const showAll = showAllStages[stageKey] ?? false;
            const isLast = index === stages.length - 1;
            return (
              <StageNode
                key={stageKey || `stage-${index}`}
                stage={stage}
                expanded={expanded}
                showAll={showAll}
                isLast={isLast}
                onToggleExpanded={() =>
                  setExpandedStages((prev) => ({
                    ...prev,
                    [stageKey]: !expanded
                  }))
                }
                onToggleShowAll={(event) => {
                  event.stopPropagation();
                  setShowAllStages((prev) => ({
                    ...prev,
                    [stageKey]: !showAll
                  }));
                }}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function StageNode({
  stage,
  expanded,
  showAll,
  isLast,
  onToggleExpanded,
  onToggleShowAll
}: {
  stage: PipelineStageViewModel;
  expanded: boolean;
  showAll: boolean;
  isLast: boolean;
  onToggleExpanded: () => void;
  onToggleShowAll: (event: ReactMouseEvent<HTMLButtonElement>) => void;
}) {
  const hasBranches = stage.parallelBranches.length > 0;
  const hasBranchSteps = stage.parallelBranches.some((branch) => branch.hasSteps);
  const hasSteps = Boolean(stage.hasSteps);
  const steps = showAll ? stage.stepsAll : stage.stepsFailedOnly;
  const stageIcon = getStageIcon(stage.statusClass);
  const nodeStyle = getStageNodeStyle(stage.statusClass);
  const connectorColor = getConnectorColor(stage.statusClass);

  return (
    <div className="relative flex" data-stage-key={stage.key}>
      <div className="flex flex-col items-center mr-5">
        <div className={nodeStyle}>{stageIcon}</div>
        {!isLast ? (
          <div
            className="stage-connector"
            style={{ "--stage-connector": connectorColor } as React.CSSProperties}
          />
        ) : null}
      </div>

      <div className={cn("flex-1 pb-6", isLast && "pb-0")}>
        <Collapsible open={expanded} onOpenChange={onToggleExpanded}>
          <Card className="overflow-hidden">
            <CollapsibleTrigger className="w-full p-0 hover:bg-accent-soft transition-colors">
              <div className="flex items-center justify-between gap-3 p-4">
                <div className="flex flex-col items-start gap-1">
                  <div className="text-sm font-medium">{stage.name || "Stage"}</div>
                  <div className="text-xs text-muted-foreground">
                    {stage.durationLabel || "Unknown"}
                  </div>
                </div>
                <StatusPill
                  label={stage.statusLabel || "Unknown"}
                  status={stage.statusClass}
                  className="text-xs"
                />
              </div>
            </CollapsibleTrigger>

            <CollapsibleContent>
              <CardContent className="border-t border-border pt-4 space-y-4">
                {hasBranches ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Parallel Branches
                      </div>
                      {hasBranchSteps ? (
                        <Button
                          variant="link"
                          size="sm"
                          onClick={onToggleShowAll}
                          className="h-auto py-0 text-xs"
                        >
                          {showAll ? "Show failed only" : "Show all steps"}
                        </Button>
                      ) : null}
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {stage.parallelBranches.map((branch, branchIndex) => (
                        <BranchCard
                          key={`${branch.key}-${branchIndex}`}
                          branch={branch}
                          showAll={showAll}
                        />
                      ))}
                    </div>
                  </div>
                ) : null}

                {hasSteps && !hasBranches ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Steps
                      </div>
                      <Button
                        variant="link"
                        size="sm"
                        onClick={onToggleShowAll}
                        className="h-auto py-0 text-xs"
                      >
                        {showAll ? "Show failed only" : "Show all steps"}
                      </Button>
                    </div>
                    {steps.length > 0 ? (
                      <StepsList steps={steps} />
                    ) : (
                      <EmptyStepsMessage showAll={showAll} />
                    )}
                  </div>
                ) : null}

                {!hasSteps && !hasBranches ? (
                  <div className="text-sm text-muted-foreground">
                    No step details available for this stage.
                  </div>
                ) : null}
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>
      </div>
    </div>
  );
}

function BranchCard({
  branch,
  showAll
}: {
  branch: PipelineStageViewModel;
  showAll: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const steps = showAll ? branch.stepsAll : branch.stepsFailedOnly;
  const hasSteps = branch.hasSteps && steps.length > 0;
  const branchIcon = getStageIcon(branch.statusClass);
  const statusClass = getStatusClass(branch.statusClass);

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded}>
      <div className="rounded border border-mutedBorder bg-muted-soft">
        <CollapsibleTrigger className="w-full p-0 hover:bg-accent-soft transition-colors rounded">
          <div className="flex items-center gap-2 p-3">
            <div
              className={cn(
                "flex h-6 w-6 items-center justify-center rounded-full border text-xs",
                statusClass
              )}
            >
              {branchIcon}
            </div>
            <div className="flex-1 text-left">
              <div className="text-xs font-medium">{branch.name || "Branch"}</div>
            </div>
            <div className="text-xs text-muted-foreground">{branch.durationLabel}</div>
          </div>
        </CollapsibleTrigger>
        {hasSteps ? (
          <CollapsibleContent>
            <div className="border-t border-border p-3 pt-2">
              <StepsList steps={steps} compact />
            </div>
          </CollapsibleContent>
        ) : null}
      </div>
    </Collapsible>
  );
}

function StepsList({
  steps,
  compact = false
}: { steps: PipelineStageStepViewModel[]; compact?: boolean }) {
  return (
    <ul className="list-none m-0 p-0 flex flex-col gap-2">
      {steps.map((step, index) => {
        const statusClass = getStatusClass(step.statusClass);
        return (
          <li
            className={cn(
              "flex items-center justify-between gap-2 rounded border border-mutedBorder bg-background",
              compact ? "px-2 py-1.5" : "px-3 py-2"
            )}
            key={`${step.name}-${index}`}
          >
            <div className="flex items-center gap-2 min-w-0">
              <div
                className={cn(
                  "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[10px]",
                  statusClass
                )}
              >
                {getStageIcon(step.statusClass)}
              </div>
              <span className={cn("truncate", compact ? "text-xs" : "text-xs font-medium")}>
                {step.name || "Step"}
              </span>
            </div>
            <span className="text-xs text-muted-foreground shrink-0">
              {step.durationLabel || "Unknown"}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function EmptyStepsMessage({ showAll }: { showAll: boolean }) {
  return (
    <div className="rounded border border-dashed border-border bg-muted-soft px-3 py-2 text-sm text-muted-foreground">
      {showAll ? "No steps available." : "No failed steps."}
    </div>
  );
}

function PipelineStagesPlaceholder(): JSX.Element {
  return (
    <div className="space-y-4">
      {[1, 2, 3].map((i) => (
        <div key={`skeleton-${i}`} className="flex">
          <div className="flex flex-col items-center mr-4">
            <Skeleton className="h-8 w-8 rounded-full" />
            {i < 3 ? <Skeleton className="w-0.5 flex-1 min-h-[24px]" /> : null}
          </div>
          <div className="flex-1 pb-6">
            <Skeleton className="h-16 w-full rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

function LoadingBanner(): JSX.Element {
  return (
    <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground">
      <span className="inline-block h-2 w-2 rounded-full bg-primary animate-ping" aria-hidden />
      Refreshing stages...
    </div>
  );
}

function collectStageKeys(stages: PipelineStageViewModel[], keys = new Set<string>()): Set<string> {
  for (const stage of stages) {
    if (typeof stage.key === "string") {
      keys.add(stage.key);
    }
    if (Array.isArray(stage.parallelBranches)) {
      collectStageKeys(stage.parallelBranches, keys);
    }
  }
  return keys;
}

function pruneStageState(
  prev: Record<string, boolean>,
  validKeys: Set<string>
): Record<string, boolean> {
  const next: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(prev)) {
    if (validKeys.has(key)) {
      next[key] = value;
    }
  }
  return next;
}
