import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "../../../../shared/webview/components/ui/tooltip";
import type { NodeExecutorViewModel } from "../../../shared/NodeDetailsContracts";

const DEFAULT_MAX_SLOTS = 48;

type ExecutorSlotGridProps = {
  executors: NodeExecutorViewModel[];
  oneOffExecutors: NodeExecutorViewModel[];
  onOpenExternal: (url: string) => void;
  maxSlots?: number;
};
export function ExecutorSlotGrid({
  executors,
  oneOffExecutors,
  onOpenExternal,
  maxSlots = DEFAULT_MAX_SLOTS
}: ExecutorSlotGridProps): JSX.Element | null {
  const allExecutors = [
    ...executors.map((executor) => ({ executor, key: `executor:${executor.id}` })),
    ...oneOffExecutors.map((executor) => ({ executor, key: `one-off:${executor.id}` }))
  ];
  if (allExecutors.length === 0) {
    return null;
  }

  const visible = allExecutors.slice(0, maxSlots);
  const overflow = allExecutors.length - visible.length;

  return (
    <ul className="executor-slot-grid" aria-label="Executor slots">
      {visible.map(({ executor, key }) => (
        <ExecutorSlot key={key} executor={executor} onOpenExternal={onOpenExternal} />
      ))}
      {overflow > 0 ? (
        <li className="self-center text-[11px] text-muted-foreground">+{overflow}</li>
      ) : null}
    </ul>
  );
}

function ExecutorSlot({
  executor,
  onOpenExternal
}: {
  executor: NodeExecutorViewModel;
  onOpenExternal: (url: string) => void;
}): JSX.Element {
  const busy = !executor.isIdle;
  const label = executor.workLabel
    ? `${executor.id} — ${executor.workLabel}`
    : `${executor.id} — ${executor.statusLabel}`;

  if (busy && executor.workUrl) {
    const workUrl = executor.workUrl;
    return (
      <li className="flex">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="executor-slot"
              data-busy="true"
              aria-label={`${label}. Open build in Jenkins.`}
              onClick={() => onOpenExternal(workUrl)}
            />
          </TooltipTrigger>
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
      </li>
    );
  }

  return (
    <li className="flex">
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="executor-slot" data-busy={busy ? "true" : "false"} aria-label={label} />
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </li>
  );
}
