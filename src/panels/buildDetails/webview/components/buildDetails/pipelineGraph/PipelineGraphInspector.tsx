import * as React from "react";
import { Button } from "../../../../../shared/webview/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle
} from "../../../../../shared/webview/components/ui/card";
import { Toggle } from "../../../../../shared/webview/components/ui/toggle";
import type { PipelineStageViewModel } from "../../../../shared/BuildDetailsContracts";
import { StatusPill } from "../StatusPill";
import { BranchCard } from "../pipelineStages/BranchCard";
import { EmptyStepsMessage } from "../pipelineStages/EmptyStepsMessage";
import { StepsList } from "../pipelineStages/StepsList";

const { useEffect, useState } = React;

export function PipelineGraphInspector({
  stage,
  onRestartStage
}: {
  stage?: PipelineStageViewModel;
  onRestartStage: (stageName: string) => void;
}) {
  const [showAllSteps, setShowAllSteps] = useState(false);

  useEffect(() => {
    setShowAllSteps(false);
  }, [stage?.key]);

  if (!stage) {
    return (
      <Card className="h-full">
        <CardHeader className="pb-3">
          <CardTitle>Stage Inspector</CardTitle>
        </CardHeader>
        <CardContent className="pt-0 text-sm text-muted-foreground">
          Select a stage in the graph to inspect its status, duration, branches, and steps.
        </CardContent>
      </Card>
    );
  }

  const stageName = stage.name.trim();
  const canRestartStage = stage.canRestartFromStage && stageName.length > 0;
  const steps = showAllSteps ? stage.stepsAll : stage.stepsFailedOnly;
  const hasDirectSteps = stage.stepsAll.length > 0;
  const hasParallelBranches = stage.parallelBranches.length > 0;
  const hasBranchSteps = stage.parallelBranches.some((branch) => branch.hasSteps);

  return (
    <Card className="h-full">
      <CardHeader className="gap-3 border-b border-border pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Stage Inspector
            </div>
            <CardTitle className="text-base">{stage.name || "Stage"}</CardTitle>
            <div className="text-xs text-muted-foreground">{stage.durationLabel || "Unknown"}</div>
          </div>
          <StatusPill label={stage.statusLabel || "Unknown"} status={stage.statusClass} />
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <span className="rounded-full border border-mutedBorder bg-muted-soft px-2 py-1">
            {stage.parallelBranches.length} branches
          </span>
          <span className="rounded-full border border-mutedBorder bg-muted-soft px-2 py-1">
            {stage.stepsAll.length} direct steps
          </span>
          {canRestartStage ? (
            <Button
              variant="outline"
              size="sm"
              className="ml-auto"
              onClick={() => onRestartStage(stageName)}
            >
              Restart from this stage
            </Button>
          ) : null}
        </div>
      </CardHeader>

      <CardContent className="space-y-4 pt-4">
        {hasParallelBranches ? (
          <section className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Parallel Branches
              </div>
              {hasBranchSteps ? (
                <Toggle
                  pressed={showAllSteps}
                  onPressedChange={(pressed) => setShowAllSteps(pressed)}
                  size="sm"
                  aria-label={showAllSteps ? "Show failed steps only" : "Show all steps"}
                >
                  {showAllSteps ? "Failed only" : "All steps"}
                </Toggle>
              ) : null}
            </div>
            <div className="grid gap-2 xl:grid-cols-2">
              {stage.parallelBranches.map((branch, index) => (
                <BranchCard key={`${branch.key}-${index}`} branch={branch} showAll={showAllSteps} />
              ))}
            </div>
          </section>
        ) : null}

        {hasDirectSteps ? (
          <section className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Steps
              </div>
              <Toggle
                pressed={showAllSteps}
                onPressedChange={(pressed) => setShowAllSteps(pressed)}
                size="sm"
                aria-label={showAllSteps ? "Show failed steps only" : "Show all steps"}
              >
                {showAllSteps ? "Failed only" : "All steps"}
              </Toggle>
            </div>
            {steps.length > 0 ? (
              <StepsList steps={steps} />
            ) : (
              <EmptyStepsMessage showAll={showAllSteps} />
            )}
          </section>
        ) : null}

        {!hasParallelBranches && !hasDirectSteps ? (
          <div className="rounded border border-mutedBorder bg-muted-soft px-3 py-2 text-sm text-muted-foreground">
            No step details available for this stage.
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
