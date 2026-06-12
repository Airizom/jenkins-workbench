import type { NodeExecutorViewModel } from "../../../shared/NodeDetailsContracts";

export interface ExecutorUtilization {
  total: number;
  busy: number;
  idle: number;
  oneOffTotal: number;
  oneOffBusy: number;
  ratio: number | undefined;
}

export type UtilizationLevel = "low" | "medium" | "high";

export function summarizeExecutorUtilization(
  executors: NodeExecutorViewModel[],
  oneOffExecutors: NodeExecutorViewModel[]
): ExecutorUtilization {
  const total = executors.length;
  const busy = executors.filter((executor) => !executor.isIdle).length;
  const oneOffTotal = oneOffExecutors.length;
  const oneOffBusy = oneOffExecutors.filter((executor) => !executor.isIdle).length;
  return {
    total,
    busy,
    idle: total - busy,
    oneOffTotal,
    oneOffBusy,
    ratio: total > 0 ? busy / total : undefined
  };
}

export function utilizationLevel(ratio: number): UtilizationLevel {
  if (ratio < 0.5) {
    return "low";
  }
  if (ratio < 0.9) {
    return "medium";
  }
  return "high";
}
