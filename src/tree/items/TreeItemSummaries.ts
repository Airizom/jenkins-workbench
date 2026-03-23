export interface JobsFolderSummary {
  total: number;
  jobs: number;
  pipelines: number;
  folders: number;
  disabled: number;
  running: number;
}

export interface NodesFolderSummary {
  total: number;
  online: number;
  offline: number;
}

export interface QueueFolderSummary {
  total: number;
}
