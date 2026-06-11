import type { NodeCapacityExecutorViewModel } from "../shared/nodeCapacity/NodeCapacityContracts";
import { isFiniteNumber } from "../shared/numbers";
import { firstNonEmpty } from "../shared/stringValues";
import type { JenkinsNodeExecutable, JenkinsNodeExecutor } from "./types";

export type { NodeCapacityExecutorViewModel as BaseNodeExecutorViewModel };

export function formatExecutorStatusLabel(isIdle: boolean): string {
  return isIdle ? "Idle" : "Busy";
}

export function buildBaseNodeExecutorViewModels(
  executors: JenkinsNodeExecutor[] | undefined,
  labelPrefix: string
): NodeCapacityExecutorViewModel[] {
  if (!Array.isArray(executors)) {
    return [];
  }

  return executors.map((executor, index) => {
    const work = executor.currentExecutable ?? executor.currentWorkUnit;
    const isIdle = !work && executor.idle !== false;
    const fallbackLabel = `${labelPrefix} ${index + 1}`;

    return {
      id: formatExecutorId(executor.number, fallbackLabel),
      statusLabel: formatExecutorStatusLabel(isIdle),
      isIdle,
      workLabel: formatExecutorWorkLabel(work),
      workUrl: firstNonEmpty(work?.url)
    };
  });
}

function formatExecutorId(number: number | undefined, fallbackLabel: string): string {
  return isFiniteNumber(number) ? `#${number}` : fallbackLabel;
}

export function formatExecutorWorkLabel(work?: JenkinsNodeExecutable): string | undefined {
  if (!work) {
    return undefined;
  }

  return (
    firstNonEmpty(work.fullDisplayName, work.displayName) ??
    (isFiniteNumber(work.number) ? `#${work.number}` : undefined) ??
    firstNonEmpty(work.url)
  );
}
