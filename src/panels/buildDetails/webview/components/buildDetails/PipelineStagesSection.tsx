import * as React from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import type {
  PipelineStageStepViewModel,
  PipelineStageViewModel
} from "../../../shared/BuildDetailsContracts";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { cn } from "../../lib/utils";
import { getStatusClass, StatusPill } from "./StatusPill";

const { useEffect, useMemo, useState } = React;

export function PipelineStagesSection({ stages }: { stages: PipelineStageViewModel[] }) {
  const [expandedStages, setExpandedStages] = useState<Record<string, boolean>>({});
  const [showAllStages, setShowAllStages] = useState<Record<string, boolean>>({});

  const stageKeys = useMemo(() => collectStageKeys(stages), [stages]);

  useEffect(() => {
    setExpandedStages((prev) => pruneStageState(prev, stageKeys));
    setShowAllStages((prev) => pruneStageState(prev, stageKeys));
  }, [stageKeys]);

  if (stages.length === 0) {
    return null;
  }

  return (
    <Card id="pipeline-section">
      <CardHeader>
        <CardTitle className="text-base">Pipeline Stages</CardTitle>
        <CardDescription>Stage status, duration, and steps from Jenkins Pipeline.</CardDescription>
      </CardHeader>
      <CardContent>
        <div
          id="pipeline-stages"
          className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-3"
        >
          {stages.map((stage, index) => {
            const stageKey = typeof stage.key === "string" ? stage.key : "";
            const expanded = expandedStages[stageKey] ?? false;
            const showAll = showAllStages[stageKey] ?? false;
            return (
              <StageCard
                key={stageKey || `stage-${index}`}
                stage={stage}
                expanded={expanded}
                showAll={showAll}
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
      </CardContent>
    </Card>
  );
}

function collectStageKeys(
  stages: PipelineStageViewModel[],
  keys = new Set<string>()
): Set<string> {
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

function StatusText({
  label,
  status,
  className
}: {
  label: string;
  status?: string;
  className?: string;
}) {
  const statusClass = getStatusClass(status);
  return <span className={cn("font-semibold", statusClass, className)}>{label}</span>;
}

function StepsList({ steps }: { steps: PipelineStageStepViewModel[] }) {
  return (
    <ul className="list-none m-0 p-0 flex flex-col gap-2">
      {steps.map((step, index) => (
        <li
          className="flex flex-col gap-1 rounded-md border border-border bg-muted px-3 py-2"
          key={`${step.name}-${index}`}
        >
          <div className="text-xs font-semibold text-foreground">{step.name || "Step"}</div>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <StatusText
              label={step.statusLabel || "Unknown"}
              status={step.statusClass}
              className="text-[11px]"
            />
            <span>{step.durationLabel || "Unknown"}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function BranchSteps({
  branch,
  showAll
}: {
  branch: PipelineStageViewModel;
  showAll: boolean;
}) {
  const steps = showAll ? branch.stepsAll : branch.stepsFailedOnly;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2 text-xs">
        <div className="font-semibold text-foreground">{branch.name || "Branch"}</div>
        <StatusText
          label={branch.statusLabel || "Unknown"}
          status={branch.statusClass}
          className="text-[11px]"
        />
        <div className="text-[11px] text-muted-foreground">
          {branch.durationLabel || "Unknown"}
        </div>
      </div>
      {steps.length > 0 ? (
        <StepsList steps={steps} />
      ) : (
        <div className="rounded-lg border border-dashed border-border px-3 py-2.5 text-muted-foreground">
          {showAll ? "No steps available." : "No failed steps."}
        </div>
      )}
    </div>
  );
}

function StageCard({
  stage,
  expanded,
  showAll,
  onToggleExpanded,
  onToggleShowAll
}: {
  stage: PipelineStageViewModel;
  expanded: boolean;
  showAll: boolean;
  onToggleExpanded: () => void;
  onToggleShowAll: (event: ReactMouseEvent<HTMLButtonElement>) => void;
}) {
  const hasBranches = stage.parallelBranches.length > 0;
  const hasSteps = Boolean(stage.hasSteps);
  const steps = showAll ? stage.stepsAll : stage.stepsFailedOnly;
  const titleLabel = expanded ? "Hide steps" : "Show steps";
  const expandedClass = expanded ? "border-ring ring-1 ring-ring" : "";

  return (
    <Card className={cn("bg-background transition-colors", expandedClass)} data-stage-key={stage.key}>
      <div className="flex flex-col gap-3 p-3">
        <button
          type="button"
          className="w-full border-0 bg-transparent p-0 text-left cursor-pointer font-inherit text-inherit flex flex-col gap-2"
          onClick={onToggleExpanded}
        >
          <div className="flex items-center justify-between gap-2.5">
            <div className="text-sm font-semibold text-foreground">{stage.name || "Stage"}</div>
            <StatusPill
              label={stage.statusLabel || "Unknown"}
              status={stage.statusClass}
              className="text-[11px]"
            />
          </div>
          <div className="flex items-center justify-between gap-2.5 text-xs text-muted-foreground">
            <div>{stage.durationLabel || "Unknown"}</div>
            <div className="text-[11px] text-primary">{titleLabel}</div>
          </div>
        </button>
        {hasBranches ? (
          <div className="flex flex-col gap-2">
            {stage.parallelBranches.map((branch, index) => (
              <div
                className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted px-3 py-2"
                key={`${branch.key}-${index}`}
              >
                <div className="text-xs font-semibold text-foreground">{branch.name || "Branch"}</div>
                <StatusText
                  label={branch.statusLabel || "Unknown"}
                  status={branch.statusClass}
                  className="text-[11px]"
                />
                <div className="text-[11px] text-muted-foreground">
                  {branch.durationLabel || "Unknown"}
                </div>
              </div>
            ))}
          </div>
        ) : null}
        <div className="border-t border-dashed border-border pt-3 flex flex-col gap-3" hidden={!expanded}>
          {hasSteps ? (
            <div className="flex items-center justify-between gap-2">
              <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                Steps
              </div>
              <Button variant="link" size="sm" className="h-auto px-0 text-xs" onClick={onToggleShowAll}>
                {showAll ? "Show failed steps" : "Show all steps"}
              </Button>
            </div>
          ) : null}
          {hasBranches ? (
            stage.parallelBranches.map((branch, index) => (
              <BranchSteps branch={branch} showAll={showAll} key={`${branch.key}-${index}`} />
            ))
          ) : hasSteps ? (
            steps.length > 0 ? (
              <StepsList steps={steps} />
            ) : (
              <div className="rounded-lg border border-dashed border-border px-3 py-2.5 text-muted-foreground">
                {showAll ? "No steps available." : "No failed steps."}
              </div>
            )
          ) : (
            <div className="rounded-lg border border-dashed border-border px-3 py-2.5 text-muted-foreground">
              No steps available.
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
