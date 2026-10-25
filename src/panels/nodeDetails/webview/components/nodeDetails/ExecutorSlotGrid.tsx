import type * as React from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "../../../../shared/webview/components/ui/tooltip";
import type { NodeExecutorViewModel } from "../../../shared/NodeDetailsContracts";
import { formatExecutorName, formatFreeExecutorLabel } from "./executorUtilization";

const DEFAULT_MAX_SLOTS = 48;

type SlotState = "busy" | "idle" | "offline";

type ExecutorSlotGridProps = {
  executors: NodeExecutorViewModel[];
  oneOffExecutors: NodeExecutorViewModel[];
  isOffline: boolean;
  onOpenExternal: (url: string) => void;
  onViewAll?: () => void;
  maxSlots?: number;
};
/**
 * Only busy slots are focusable: they open the running build, while idle and
 * offline slots are labelled images, so a large node does not add dozens of
 * tab stops. Each list's own label carries the counts. One-off executors get
 * their own row so they stay visible and distinct when the node overflows.
 */
export function ExecutorSlotGrid({
  executors,
  oneOffExecutors,
  isOffline,
  onOpenExternal,
  onViewAll,
  maxSlots = DEFAULT_MAX_SLOTS
}: ExecutorSlotGridProps): React.JSX.Element | null {
  if (executors.length === 0 && oneOffExecutors.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      {executors.length > 0 ? (
        <SlotList
          label="Executor slots"
          executors={executors}
          keyPrefix="executor"
          isOffline={isOffline}
          maxSlots={maxSlots}
          onOpenExternal={onOpenExternal}
          onViewAll={onViewAll}
        />
      ) : null}
      {oneOffExecutors.length > 0 ? (
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-caption text-muted-foreground" aria-hidden="true">
            One-off
          </span>
          <SlotList
            label="One-off executors"
            executors={oneOffExecutors}
            keyPrefix="one-off"
            isOffline={isOffline}
            maxSlots={maxSlots}
            onOpenExternal={onOpenExternal}
            onViewAll={onViewAll}
          />
        </div>
      ) : null}
    </div>
  );
}

function SlotList({
  label,
  executors,
  keyPrefix,
  isOffline,
  maxSlots,
  onOpenExternal,
  onViewAll
}: {
  label: string;
  executors: NodeExecutorViewModel[];
  keyPrefix: string;
  isOffline: boolean;
  maxSlots: number;
  onOpenExternal: (url: string) => void;
  onViewAll?: () => void;
}): React.JSX.Element {
  const visible = executors.slice(0, maxSlots);
  const overflow = executors.length - visible.length;
  const busyCount = executors.filter((executor) => !executor.isIdle).length;
  const restLabel = formatFreeExecutorLabel(isOffline).toLowerCase();

  return (
    <ul
      className="executor-slot-grid"
      aria-label={`${label}: ${busyCount} busy, ${executors.length - busyCount} ${restLabel}`}
    >
      {visible.map((executor) => (
        <ExecutorSlot
          key={`${keyPrefix}:${executor.id}`}
          executor={executor}
          state={resolveSlotState(executor, isOffline)}
          onOpenExternal={onOpenExternal}
        />
      ))}
      {overflow > 0 ? (
        <li className="flex self-center">
          {onViewAll ? (
            <button
              type="button"
              className="focus-ring rounded-sm text-caption text-link hover:text-link-hover hover:underline"
              aria-label={`View all executors (${overflow} more)`}
              onClick={onViewAll}
            >
              +{overflow}
            </button>
          ) : (
            <span className="text-caption text-muted-foreground">+{overflow}</span>
          )}
        </li>
      ) : null}
    </ul>
  );
}

function resolveSlotState(executor: NodeExecutorViewModel, isOffline: boolean): SlotState {
  if (!executor.isIdle) {
    return "busy";
  }
  return isOffline ? "offline" : "idle";
}

const SLOT_STATE_LABELS: Record<SlotState, string> = {
  busy: "Busy",
  idle: formatFreeExecutorLabel(false),
  offline: formatFreeExecutorLabel(true)
};

function ExecutorSlot({
  executor,
  state,
  onOpenExternal
}: {
  executor: NodeExecutorViewModel;
  state: SlotState;
  onOpenExternal: (url: string) => void;
}): React.JSX.Element {
  const detail =
    state === "busy" ? (executor.workLabel ?? SLOT_STATE_LABELS.busy) : SLOT_STATE_LABELS[state];
  const label = `${formatExecutorName(executor.id)}: ${detail}`;

  if (state === "busy" && executor.workUrl) {
    const workUrl = executor.workUrl;
    return (
      <li className="flex">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="executor-slot"
              data-state={state}
              aria-label={`${label}. Open in Jenkins.`}
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
          <span className="executor-slot" data-state={state} role="img" aria-label={label} />
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </li>
  );
}
