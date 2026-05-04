import * as React from "react";
import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger
} from "../../../../../shared/webview/components/ui/accordion";
import { Button } from "../../../../../shared/webview/components/ui/button";
import { Toggle } from "../../../../../shared/webview/components/ui/toggle";
import { ChevronDownIcon, TerminalIcon } from "../../../../../shared/webview/icons";
import { cn } from "../../../../../shared/webview/lib/utils";
import type {
  PipelineLogTargetViewModel,
  PipelineStageViewModel
} from "../../../../shared/BuildDetailsContracts";
import { StatusPill } from "../StatusPill";
import { BranchCard } from "./BranchCard";
import { EmptyStepsMessage } from "./EmptyStepsMessage";
import { getConnectorColor, getStageIcon, getStageNodeStyle } from "./PipelineStageIcons";
import { StepsList } from "./StepsList";

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
  const hasBranches = stage.parallelBranches.length > 0;
  const hasBranchSteps = stage.parallelBranches.some((branch) => branch.hasSteps);
  const hasSteps = Boolean(stage.hasSteps);
  const steps = showAll ? stage.stepsAll : stage.stepsFailedOnly;
  const stageIcon = getStageIcon(stage.statusClass);
  const nodeStyle = getStageNodeStyle(stage.statusClass);
  const connectorColor = getConnectorColor(stage.statusClass);
  const stageName = stage.name.trim();
  const canRestartStage = stage.canRestartFromStage && stageName.length > 0;
  const stageLogTarget = stage.logTarget;

  return (
    <div className="relative flex" data-stage-key={stage.key}>
      <div className="flex flex-col items-center mr-3">
        <div className={nodeStyle}>{stageIcon}</div>
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
                <div className="flex flex-col items-start gap-0.5">
                  <div className="text-xs font-medium">{stage.name || "Stage"}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {stage.durationLabel || "Unknown"}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <StatusPill
                    label={stage.statusLabel || "Unknown"}
                    status={stage.statusClass}
                    className="text-[10px]"
                  />
                  <ChevronDownIcon
                    className={cn(
                      "text-muted-foreground transition-transform duration-200",
                      "group-data-[state=open]:rotate-180 group-data-[state=open]:text-foreground"
                    )}
                  />
                </div>
              </button>
            </AccordionTrigger>

            <AccordionContent>
              <div className="border-t border-border px-3 py-2.5 space-y-2.5">
                {canRestartStage ? (
                  <div className="flex items-center justify-end gap-2">
                    {stageLogTarget ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-6 px-2 text-[10px]"
                        onClick={(event) => {
                          event.stopPropagation();
                          onSelectPipelineLog(stageLogTarget);
                        }}
                      >
                        <TerminalIcon className="mr-1 h-3 w-3" />
                        Log
                      </Button>
                    ) : null}
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 px-2 text-[10px]"
                      onClick={(event) => {
                        event.stopPropagation();
                        onRestartStage(stageName);
                      }}
                    >
                      Restart from this stage
                    </Button>
                  </div>
                ) : stageLogTarget ? (
                  <div className="flex items-center justify-end">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 px-2 text-[10px]"
                      onClick={(event) => {
                        event.stopPropagation();
                        onSelectPipelineLog(stageLogTarget);
                      }}
                    >
                      <TerminalIcon className="mr-1 h-3 w-3" />
                      Log
                    </Button>
                  </div>
                ) : null}
                {hasBranches ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        Parallel Branches
                      </div>
                      {hasBranchSteps ? (
                        <Toggle
                          pressed={showAll}
                          onPressedChange={(pressed) => onShowAllChange(pressed)}
                          size="sm"
                          aria-label={showAll ? "Show failed steps only" : "Show all steps"}
                        >
                          {showAll ? "Failed only" : "All steps"}
                        </Toggle>
                      ) : null}
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {stage.parallelBranches.map((branch, branchIndex) => (
                        <BranchCard
                          key={`${branch.key}-${branchIndex}`}
                          branch={branch}
                          showAll={showAll}
                          onSelectPipelineLog={onSelectPipelineLog}
                        />
                      ))}
                    </div>
                  </div>
                ) : null}

                {hasSteps && !hasBranches ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        Steps
                      </div>
                      <Toggle
                        pressed={showAll}
                        onPressedChange={(pressed) => onShowAllChange(pressed)}
                        size="sm"
                        aria-label={showAll ? "Show failed steps only" : "Show all steps"}
                      >
                        {showAll ? "Failed only" : "All steps"}
                      </Toggle>
                    </div>
                    {steps.length > 0 ? (
                      <StepsList steps={steps} onSelectPipelineLog={onSelectPipelineLog} />
                    ) : (
                      <EmptyStepsMessage showAll={showAll} />
                    )}
                  </div>
                ) : null}

                {!hasSteps && !hasBranches ? (
                  <div className="text-xs text-muted-foreground">No step details available.</div>
                ) : null}
              </div>
            </AccordionContent>
          </div>
        </AccordionItem>
      </div>
    </div>
  );
}
