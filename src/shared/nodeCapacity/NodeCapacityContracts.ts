import type { QueueWorkItemViewModel } from "../queueWork/QueueWorkContracts";

export type NodeCapacitySeverity = "critical" | "warning" | "normal";

export type NodeCapacityPoolKind = "label" | "any";

export interface NodeCapacityOfflineImpactViewModel {
  nodeName: string;
  nodeUrl?: string;
  executors: number;
  reason?: string;
}

export interface NodeCapacityExecutorViewModel {
  id: string;
  statusLabel: string;
  isIdle: boolean;
  workLabel?: string;
  workUrl?: string;
}

export interface NodeCapacityNodeViewModel {
  displayName: string;
  name: string;
  nodeUrl?: string;
  statusLabel: string;
  isOffline: boolean;
  isTemporarilyOffline: boolean;
  offlineReason?: string;
  labels: string[];
  poolLabels: string[];
  hiddenLabels: string[];
  totalExecutors: number;
  busyExecutors: number;
  idleExecutors: number;
  offlineExecutors: number;
  executorSummary: string;
  executorsLoaded: boolean;
  executors: NodeCapacityExecutorViewModel[];
  matchingQueueItems: QueueWorkItemViewModel[];
  anyQueueItems: QueueWorkItemViewModel[];
  selfLabelQueueItems: QueueWorkItemViewModel[];
}

export interface NodeCapacityPoolViewModel {
  id: string;
  label: string;
  kind: NodeCapacityPoolKind;
  severity: NodeCapacitySeverity;
  statusLabel: string;
  nodes: NodeCapacityNodeViewModel[];
  queueItems: QueueWorkItemViewModel[];
  offlineImpact: NodeCapacityOfflineImpactViewModel[];
  totalNodes: number;
  onlineNodes: number;
  offlineNodes: number;
  totalExecutors: number;
  busyExecutors: number;
  idleExecutors: number;
  offlineExecutors: number;
  queuedCount: number;
  stuckCount: number;
  blockedCount: number;
  buildableCount: number;
}

export interface NodeCapacitySummaryViewModel {
  totalNodes: number;
  onlineNodes: number;
  offlineNodes: number;
  totalExecutors: number;
  busyExecutors: number;
  idleExecutors: number;
  offlineExecutors: number;
  queuedCount: number;
  stuckCount: number;
  blockedCount: number;
  buildableCount: number;
  bottleneckCount: number;
}

export interface NodeCapacityViewModel {
  environmentLabel: string;
  updatedAt: string;
  summary: NodeCapacitySummaryViewModel;
  pools: NodeCapacityPoolViewModel[];
  hiddenLabelQueueItems: QueueWorkItemViewModel[];
  errors: string[];
  loading: boolean;
}

export interface NodeCapacityUpdateMessage {
  type: "updateNodeCapacity";
  payload: NodeCapacityViewModel;
}

export interface NodeCapacityNodeExecutorsUpdateMessage {
  type: "updateNodeCapacityNodeExecutors";
  payload: Array<{
    nodeUrl: string;
    executors: NodeCapacityExecutorViewModel[];
  }>;
}
