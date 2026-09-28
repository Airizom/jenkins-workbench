import type { NodeExecutorViewModel } from "../../../shared/NodeDetailsContracts";

export interface ExecutorUtilization {
  total: number;
  busy: number;
  /** Always 0 for an offline node: its free executors are unavailable, not idle. */
  idle: number;
  offline: number;
  oneOffTotal: number;
  oneOffBusy: number;
  ratio: number | undefined;
}

export function summarizeExecutorUtilization(
  executors: NodeExecutorViewModel[],
  oneOffExecutors: NodeExecutorViewModel[],
  isOffline = false
): ExecutorUtilization {
  const total = executors.length;
  const busy = executors.filter((executor) => !executor.isIdle).length;
  const oneOffTotal = oneOffExecutors.length;
  const oneOffBusy = oneOffExecutors.filter((executor) => !executor.isIdle).length;
  return {
    total,
    busy,
    idle: isOffline ? 0 : total - busy,
    offline: isOffline ? total - busy : 0,
    oneOffTotal,
    oneOffBusy,
    ratio: total > 0 ? busy / total : undefined
  };
}

/** "3 busy · 1 idle" for online nodes, "4 offline" (plus any draining builds) for offline ones. */
export function formatExecutorCounts(utilization: ExecutorUtilization): string {
  if (utilization.offline > 0) {
    return utilization.busy > 0
      ? `${utilization.busy} busy · ${utilization.offline} offline`
      : `${utilization.offline} offline`;
  }
  return `${utilization.busy} busy · ${utilization.idle} idle`;
}

/** Executor ids are "#0" when Jenkins reports a number, else a label like "Executor 1". */
export function formatExecutorName(id: string): string {
  return /^#?\d+$/.test(id) ? `Executor #${id.replace(/^#/, "")}` : id;
}
