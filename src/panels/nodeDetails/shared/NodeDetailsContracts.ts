import type { NodeStatusClass } from "../../../jenkins/NodeFormatters";
import type { NodeCapacityExecutorViewModel } from "../../../shared/nodeCapacity/NodeCapacityContracts";
import type { NodeQueuedWorkViewModel } from "../../../shared/queueWork/QueueWorkContracts";

export type { NodeStatusClass };

export interface NodeExecutorViewModel extends NodeCapacityExecutorViewModel {
  progressPercent?: number;
  progressLabel?: string;
  workDurationLabel?: string;
  workDurationMs?: number;
}

export interface NodeMonitorViewModel {
  key: string;
  summary: string;
  raw: unknown;
}

export interface NodeDetailsViewModel {
  /** False when Jenkins returned no node data yet (for example, the first load failed). */
  detailsAvailable: boolean;
  /**
   * True when the latest refresh failed and the view still shows the last
   * successfully loaded details (with that load's `updatedAt`).
   */
  refreshFailed: boolean;
  /** Jenkins environment the node belongs to, shown as the hero eyebrow. */
  environmentLabel: string;
  displayName: string;
  name: string;
  description?: string;
  url?: string;
  /** Time of the last successful load; a failed refresh keeps the previous value. */
  updatedAt: string;
  statusLabel: string;
  statusClass: NodeStatusClass;
  isOffline: boolean;
  isTemporarilyOffline: boolean;
  canTakeOffline: boolean;
  canBringOnline: boolean;
  canLaunchAgent: boolean;
  canOpenAgentInstructions: boolean;
  offlineReason?: string;
  /** Epoch ms when Jenkins recorded the offline cause, when reported. */
  offlineSinceMs?: number;
  /** "Running builds", "Idle", "Offline", or "Not available". */
  activityLabel: string;
  /** "3 of 4 busy", "4 offline", "4 total", or "Not available". */
  executorsLabel: string;
  labels: string[];
  jnlpAgentLabel?: string;
  launchSupportedLabel?: string;
  manualLaunchLabel?: string;
  executors: NodeExecutorViewModel[];
  oneOffExecutors: NodeExecutorViewModel[];
  queuedWork: NodeQueuedWorkViewModel;
  monitorData: NodeMonitorViewModel[];
  loadStatistics: NodeMonitorViewModel[];
  rawJson: string;
  errors: string[];
  advancedLoaded: boolean;
}
