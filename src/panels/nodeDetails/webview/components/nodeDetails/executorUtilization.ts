import type { NodeExecutorViewModel } from "../../../shared/NodeDetailsContracts";

export interface ExecutorUtilization {
  total: number;
  busy: number;
  /** Always 0 for an offline node: its free executors are unavailable, not idle. */
  idle: number;
  offline: number;
  isOffline: boolean;
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
    isOffline,
    oneOffTotal,
    oneOffBusy,
    ratio: total > 0 ? busy / total : undefined
  };
}

/**
 * "+1 one-off" when every one-off executor is running (the usual case: Jenkins
 * creates them per flyweight task), else "+2 one-off · 1 busy".
 */
export function formatOneOffExecutors(utilization: ExecutorUtilization): string {
  const total = `+${utilization.oneOffTotal} one-off`;
  return utilization.oneOffBusy === utilization.oneOffTotal
    ? total
    : `${total} · ${utilization.oneOffBusy} busy`;
}

/** A free executor on an offline node is unavailable, not idle. */
export function formatFreeExecutorLabel(isOffline: boolean): "Offline" | "Idle" {
  return isOffline ? "Offline" : "Idle";
}

/** Executor ids are "#0" when Jenkins reports a number, else a label like "Executor 1". */
export function formatExecutorName(id: string): string {
  return /^#?\d+$/.test(id) ? `Executor #${id.replace(/^#/, "")}` : id;
}
