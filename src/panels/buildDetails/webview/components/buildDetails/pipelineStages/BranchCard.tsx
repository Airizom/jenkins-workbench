import * as React from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from "../../../../../shared/webview/components/ui/collapsible";
import { ChevronDownIcon } from "../../../../../shared/webview/icons";
import { cn } from "../../../../../shared/webview/lib/utils";
import type { PipelineStageViewModel } from "../../../../shared/BuildDetailsContracts";
import { getStatusClass } from "../StatusPill";
import { getStageIcon } from "./PipelineStageIcons";
import { StepsList } from "./StepsList";

const { useState } = React;

export function BranchCard({
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
    <Collapsible open={expanded} onOpenChange={setExpanded} className="group">
      <div className="overflow-hidden rounded border border-mutedBorder bg-muted-soft transition-colors group-data-[state=open]:border-border group-data-[state=open]:bg-muted-strong">
        <CollapsibleTrigger asChild className="gap-2 px-2.5 py-2 hover:bg-accent-soft">
          <button type="button">
            <div className="flex items-center gap-1.5">
              <div
                className={cn(
                  "flex h-5 w-5 items-center justify-center rounded-full border text-[9px]",
                  statusClass
                )}
              >
                {branchIcon}
              </div>
              <span className="text-[11px] font-medium">{branch.name || "Branch"}</span>
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
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
        {hasSteps ? (
          <CollapsibleContent className="border-t border-border px-2.5 pb-2 pt-1.5">
            <StepsList steps={steps} compact />
          </CollapsibleContent>
        ) : null}
      </div>
    </Collapsible>
  );
}
