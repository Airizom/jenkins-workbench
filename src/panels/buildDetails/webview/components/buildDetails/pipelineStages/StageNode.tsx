import * as React from "react";
import { ResultBadge } from "../../../../../shared/webview/components/ResultBadge";
import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger
} from "../../../../../shared/webview/components/ui/accordion";
import { Button } from "../../../../../shared/webview/components/ui/button";
import { ChevronDownIcon, TerminalIcon } from "../../../../../shared/webview/icons";
import {
  resolveBuildResultStageNodeClass,
  resolveBuildResultStyle
} from "../../../../../shared/webview/lib/statusStyles";
import { cn } from "../../../../../shared/webview/lib/utils";
import type {
  PipelineLogTargetViewModel,
  PipelineStageViewModel
} from "../../../../shared/BuildDetailsContracts";
import { BranchCard } from "./BranchCard";
import { EmptyStepsMessage } from "./EmptyStepsMessage";
import { getStageIcon } from "./PipelineStageIcons";
import { StepsList } from "./StepsList";
import { StepsVisibilityToggle } from "./StepsVisibilityToggle";
import { describeStageMeta, isStageNotRun } from "./stageMeta";
export function StageNode({
  stageId,
  stage,
  showAll,
  isLast,
  onRestartStage,
  onSelectPipelineLog,
  onShowAllChange
}: {
  stageId: string;
  stage: PipelineStageViewModel;
  showAll: boolean;
  isLast: boolean;
  onRestartStage: (stageName: string) => void;
  onSelectPipelineLog: (target: PipelineLogTargetViewModel) => void;
  onShowAllChange: (next: boolean) => void;
}) {
  const stageIcon = getStageIcon(stage.statusClass);
  const nodeStyle = resolveBuildResultStageNodeClass(stage.statusClass);
  const connectorColor = resolveBuildResultStyle(stage.statusClass).connectorColor;
  const didNotRun = isStageNotRun(stage);
  const stageMeta = describeStageMeta(stage);

  return (
    <div className="relative flex" data-stage-key={stage.key}>
      <div className="flex flex-col items-center mr-3">
        <div className={nodeStyle} aria-hidden="true">
          {stageIcon}
        </div>
        {!isLast ? (
          <div
            className="stage-connector"
            style={{ "--stage-connector": connectorColor } as React.CSSProperties}
          />
        ) : null}
      </div>

      <div className={cn("flex-1 pb-3", isLast && "pb-0")}>
        <AccordionItem value={stageId} className="group border-b-0">
          <div className="overflow-hidden rounded border border-mutedBorder bg-card transition-colors group-data-[state=open]:border-border group-data-[state=open]:bg-muted-strong">
            <AccordionTrigger asChild className="gap-3 px-3 py-2 hover:bg-accent-soft">
              <button type="button">
                <div className="flex min-w-0 flex-col items-start gap-0.5">
                  <div
                    className={cn(
                      "max-w-full truncate text-xs font-medium",
                      didNotRun && "text-muted-foreground"
                    )}
                    title={stage.name || undefined}
                  >
                    {stage.name || "Stage"}
                  </div>
                  <div className="text-caption text-muted-foreground tabular-nums">{stageMeta}</div>
                </div>
                <div className="flex items-center gap-2">
                  <ResultBadge
                    label={stage.statusLabel || "Unknown"}
                    status={stage.statusClass}
                    className="text-caption"
                  />
                  <ChevronDownIcon
                    className={cn(
                      "h-3.5 w-3.5 -rotate-90 text-muted-foreground transition-transform duration-200",
                      "group-data-[state=open]:rotate-0 group-data-[state=open]:text-foreground"
                    )}
                  />
                </div>
              </button>
            </AccordionTrigger>

            <AccordionContent>
              <StageDetails
                stage={stage}
                showAll={showAll}
                onRestartStage={onRestartStage}
                onSelectPipelineLog={onSelectPipelineLog}
                onShowAllChange={onShowAllChange}
              />
            </AccordionContent>
          </div>
        </AccordionItem>
      </div>
    </div>
  );
}

type StageDetailsProps = {
  stage: PipelineStageViewModel;
  showAll: boolean;
  onRestartStage: (stageName: string) => void;
  onSelectPipelineLog: (target: PipelineLogTargetViewModel) => void;
  onShowAllChange: (next: boolean) => void;
};

function StageDetails(props: StageDetailsProps) {
  const { stage, showAll, onSelectPipelineLog } = props;
  const hasBranches = stage.parallelBranches.length > 0;
  const hasDirectSteps = stage.stepsAll.length > 0;
  const steps = showAll ? stage.stepsAll : stage.stepsFailedOnly;
  return (
    <div className="border-t border-border px-3 py-2.5 space-y-2.5">
      <StageToolbar {...props} />
      {hasBranches ? (
        <div className="space-y-2">
          <div className="text-caption font-medium uppercase tracking-wide text-muted-foreground">
            Parallel branches
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {stage.parallelBranches.map((branch) => (
              <BranchCard
                key={branch.key}
                branch={branch}
                showAll={showAll}
                onSelectPipelineLog={onSelectPipelineLog}
              />
            ))}
          </div>
        </div>
      ) : null}

      {hasDirectSteps ? (
        <div className="space-y-2">
          <div className="text-caption font-medium uppercase tracking-wide text-muted-foreground">
            {showAll ? "Steps" : "Failed steps"}
          </div>
          {steps.length > 0 ? (
            <StepsList steps={steps} onSelectPipelineLog={onSelectPipelineLog} />
          ) : (
            <EmptyStepsMessage showAll={showAll} />
          )}
        </div>
      ) : null}

      {!hasDirectSteps && !hasBranches ? (
        <div className="text-xs text-muted-foreground">No step details available.</div>
      ) : null}
    </div>
  );
}

function StageToolbar({
  stage,
  showAll,
  onRestartStage,
  onSelectPipelineLog,
  onShowAllChange
}: StageDetailsProps) {
  const stageName = stage.name;
  const canRestartStage = stage.canRestartFromStage && stageName.trim().length > 0;
  const stageLogTarget = stage.logTarget;
  // The filter applies to both direct and branch steps.
  const hasAnySteps =
    stage.stepsAll.length > 0 || stage.parallelBranches.some((branch) => branch.hasSteps);
  const hasStageToolbar = Boolean(stageLogTarget) || canRestartStage || hasAnySteps;
  return hasStageToolbar ? (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {hasAnySteps ? (
        <div className="mr-auto">
          <StepsVisibilityToggle showAll={showAll} onShowAllChange={onShowAllChange} />
        </div>
      ) : null}
      {stageLogTarget ? (
        <Button
          variant="outline"
          size="sm"
          className="h-6 px-2 text-caption"
          onClick={(event) => {
            event.stopPropagation();
            onSelectPipelineLog(stageLogTarget);
          }}
        >
          <TerminalIcon className="mr-1 h-3 w-3" />
          Log
        </Button>
      ) : null}
      {canRestartStage ? (
        <Button
          variant="outline"
          size="sm"
          className="h-6 px-2 text-caption"
          onClick={(event) => {
            event.stopPropagation();
            onRestartStage(stageName);
          }}
        >
          Restart from this stage
        </Button>
      ) : null}
    </div>
  ) : null;
}
