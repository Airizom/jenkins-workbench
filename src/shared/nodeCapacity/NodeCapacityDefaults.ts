import type { NodeCapacitySummaryViewModel, NodeCapacityViewModel } from "./NodeCapacityContracts";

export function createEmptyNodeCapacitySummary(): NodeCapacitySummaryViewModel {
  return {
    totalNodes: 0,
    onlineNodes: 0,
    offlineNodes: 0,
    totalExecutors: 0,
    busyExecutors: 0,
    idleExecutors: 0,
    offlineExecutors: 0,
    queuedCount: 0,
    stuckCount: 0,
    blockedCount: 0,
    buildableCount: 0,
    bottleneckCount: 0
  };
}

export function buildNodeCapacityErrorViewModel(
  environmentLabel: string,
  errors: string[],
  options?: { loading?: boolean }
): NodeCapacityViewModel {
  return {
    environmentLabel,
    updatedAt: new Date().toISOString(),
    summary: createEmptyNodeCapacitySummary(),
    pools: [],
    hiddenLabelQueueItems: [],
    errors,
    loading: options?.loading ?? false
  };
}
