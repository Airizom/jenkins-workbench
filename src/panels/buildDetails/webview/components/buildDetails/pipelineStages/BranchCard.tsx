import * as React from "react";
import { Button } from "../../../../../shared/webview/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from "../../../../../shared/webview/components/ui/collapsible";
import { ChevronDownIcon, TerminalIcon } from "../../../../../shared/webview/icons";
import { cn } from "../../../../../shared/webview/lib/utils";
import type {
  PipelineLogTargetViewModel,
  PipelineStageViewModel
} from "../../../../shared/BuildDetailsContracts";
import { getStatusClass } from "../StatusPill";
import { getStageIcon } from "./PipelineStageIcons";
import { StepsList } from "./StepsList";

const { useState } = React;

export function BranchCard({
  branch,
  showAll,
  onSelectPipelineLog
}: {
  branch: PipelineStageViewModel;
  showAll: boolean;
  onSelectPipelineLog?: (target: PipelineLogTargetViewModel) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const steps = showAll ? branch.stepsAll : branch.stepsFailedOnly;
  const hasSteps = branch.hasSteps && steps.length > 0;
  const branchIcon = getStageIcon(branch.statusClass);
  const statusClass = getStatusClass(branch.statusClass);
  const branchTarget = branch.logTarget;

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded} className="group">
      <div className="overflow-hidden rounded border border-mutedBorder bg-muted-soft transition-colors group-data-[state=open]:border-border group-data-[state=open]:bg-muted-strong">
        <div className="flex items-center gap-1.5 px-2.5 py-2 hover:bg-accent-soft">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left"
            >
              <div className="flex min-w-0 items-center gap-1.5">
                <div
                  className={cn(
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[9px]",
                    statusClass
                  )}
                >
                  {branchIcon}
                </div>
                <span className="truncate text-[11px] font-medium">{branch.name || "Branch"}</span>
              </div>
              <div className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                <span>{branch.durationLabel}</span>
                <ChevronDownIcon
                  className={cn(
                    "h-3.5 w-3.5 text-muted-foreground transition-transform duration-200",
                    "group-data-[state=open]:rotate-180 group-data-[state=open]:text-foreground"
                  )}
                />
              </div>
            </button>
          </CollapsibleTrigger>
          {branchTarget && onSelectPipelineLog ? (
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 shrink-0"
              onClick={() => onSelectPipelineLog(branchTarget)}
            >
              <TerminalIcon className="h-3 w-3" />
            </Button>
          ) : null}
        </div>
        {hasSteps ? (
          <CollapsibleContent className="border-t border-border px-2.5 pb-2 pt-1.5">
            <StepsList steps={steps} compact onSelectPipelineLog={onSelectPipelineLog} />
          </CollapsibleContent>
        ) : null}
      </div>
    </Collapsible>
  );
}
