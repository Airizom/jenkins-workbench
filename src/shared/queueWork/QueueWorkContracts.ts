export interface QueueWorkItemViewModel {
  id: number;
  name: string;
  position: number;
  statusLabel: string;
  reason?: string;
  queuedForLabel?: string;
  queuedForLabels: string[];
  inQueueSince?: number;
  queuedDurationLabel?: string;
  taskUrl?: string;
  blocked: boolean;
  buildable: boolean;
  stuck: boolean;
}

export interface NodeQueuedWorkViewModel {
  matchingQueueItems: QueueWorkItemViewModel[];
  anyQueueItems: QueueWorkItemViewModel[];
  selfLabelQueueItems: QueueWorkItemViewModel[];
}
