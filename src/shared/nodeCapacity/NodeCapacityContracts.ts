import type {
  NodeQueuedWorkViewModel,
  QueueWorkItemViewModel
} from "../queueWork/QueueWorkContracts";

export type NodeCapacitySeverity = "critical" | "warning" | "normal";

export type NodeCapacityPoolKind = "label" | "any";

export interface NodeCapacityExecutorViewModel {
  id: string;
  statusLabel: string;
  isIdle: boolean;
  workLabel?: string;
  workUrl?: string;
}

export interface NodeCapacityNodeViewModel extends NodeQueuedWorkViewModel {
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
  /**
   * Webview-only hydration status for `executors`. The host always sends
   * nodes without it; the webview sets it while a request is in flight or
   * after the node's executor request failed.
   */
  executorsLoadState?: "loading" | "error";
  executorsError?: string;
}

export interface NodeCapacityPoolViewModel {
  id: string;
  label: string;
  kind: NodeCapacityPoolKind;
  severity: NodeCapacitySeverity;
  statusLabel: string;
  nodes: NodeCapacityNodeViewModel[];
  queueItems: QueueWorkItemViewModel[];
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
  /** Pools with stuck work or queued work and no idle executors (critical severity). */
  saturatedPoolCount: number;
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

/** One node's executor hydration outcome; a failed node never fails its batch. */
export type NodeCapacityNodeExecutorsResult =
  | { nodeUrl: string; executors: NodeCapacityExecutorViewModel[]; error?: undefined }
  | { nodeUrl: string; executors?: undefined; error: string };

export interface NodeCapacityNodeExecutorsUpdateMessage {
  type: "updateNodeCapacityNodeExecutors";
  /** Echoes the `requestId` of the webview's `loadNodeCapacityExecutors` message. */
  requestId: number;
  payload: NodeCapacityNodeExecutorsResult[];
}
