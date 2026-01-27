export type NodeStatusClass = "online" | "offline" | "idle" | "temporary" | "unknown";

export interface NodeExecutorViewModel {
  id: string;
  statusLabel: string;
  isIdle: boolean;
  progressPercent?: number;
  progressLabel?: string;
  workLabel?: string;
  workUrl?: string;
  workDurationLabel?: string;
  workDurationMs?: number;
}

export interface NodeMonitorViewModel {
  key: string;
  summary: string;
  raw: unknown;
}

export interface NodeDetailsViewModel {
  displayName: string;
  name: string;
  description?: string;
  url?: string;
  updatedAt: string;
  statusLabel: string;
  statusClass: NodeStatusClass;
  offlineReason?: string;
  idleLabel: string;
  executorsLabel: string;
  labels: string[];
  jnlpAgentLabel?: string;
  launchSupportedLabel?: string;
  manualLaunchLabel?: string;
  executors: NodeExecutorViewModel[];
  oneOffExecutors: NodeExecutorViewModel[];
  monitorData: NodeMonitorViewModel[];
  loadStatistics: NodeMonitorViewModel[];
  rawJson: string;
  errors: string[];
  advancedLoaded: boolean;
}

export interface NodeDetailsUpdateMessage {
  type: "updateNodeDetails";
  payload: NodeDetailsViewModel;
}
