import { getResultBadgeClass } from "../../../../../shared/webview/components/ResultBadge";
import { Button } from "../../../../../shared/webview/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "../../../../../shared/webview/components/ui/tooltip";
import { TerminalIcon } from "../../../../../shared/webview/icons";
import { cn } from "../../../../../shared/webview/lib/utils";
import type {
  PipelineLogTargetViewModel,
  PipelineStageStepViewModel
} from "../../../../shared/BuildDetailsContracts";
import { getStageIcon } from "./PipelineStageIcons";
export function StepsList({
  steps,
  compact = false,
  onSelectPipelineLog
}: {
  steps: PipelineStageStepViewModel[];
  compact?: boolean;
  onSelectPipelineLog?: (target: PipelineLogTargetViewModel) => void;
}) {
  return (
    <ul className="list-none m-0 p-0 flex flex-col gap-1">
      {steps.map((step) => {
        const logTarget = step.logTarget;
        return (
          <li
            className={cn(
              "flex items-center justify-between gap-1.5 rounded border border-mutedBorder bg-background",
              compact ? "px-2 py-1" : "px-2.5 py-1.5"
            )}
            key={step.key}
          >
            <div className="flex items-center gap-1.5 min-w-0">
              <div
                className={cn(
                  "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border text-[10px]",
                  getResultBadgeClass(step.statusClass)
                )}
              >
                {getStageIcon(step.statusClass)}
              </div>
              <span className="text-[11px] truncate">{step.name || "Step"}</span>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <span className="text-[11px] text-muted-foreground">{step.durationLabel || "—"}</span>
              {logTarget && onSelectPipelineLog ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Open log for ${step.name.trim() || "step"}`}
                      className="h-5 w-5"
                      onClick={() => onSelectPipelineLog(logTarget)}
                    >
                      <TerminalIcon className="h-3 w-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Open step log</TooltipContent>
                </Tooltip>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
