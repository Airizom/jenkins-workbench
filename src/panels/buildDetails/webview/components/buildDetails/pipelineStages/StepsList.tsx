import { cn } from "../../../../../shared/webview/lib/utils";
import type { PipelineStageStepViewModel } from "../../../../shared/BuildDetailsContracts";
import { getStatusClass } from "../StatusPill";
import { getStageIcon } from "./PipelineStageIcons";

export function StepsList({
  steps,
  compact = false
}: { steps: PipelineStageStepViewModel[]; compact?: boolean }) {
  return (
    <ul className="list-none m-0 p-0 flex flex-col gap-1">
      {steps.map((step, index) => {
        const statusClass = getStatusClass(step.statusClass);
        return (
          <li
            className={cn(
              "flex items-center justify-between gap-1.5 rounded border border-mutedBorder bg-background",
              compact ? "px-2 py-1" : "px-2.5 py-1.5"
            )}
            key={`${step.name}-${index}`}
          >
            <div className="flex items-center gap-1.5 min-w-0">
              <div
                className={cn(
                  "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border text-[8px]",
                  statusClass
                )}
              >
                {getStageIcon(step.statusClass)}
              </div>
              <span className="text-[11px] truncate">{step.name || "Step"}</span>
            </div>
            <span className="text-[11px] text-muted-foreground shrink-0">
              {step.durationLabel || "—"}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
