export interface PipelineRun {
  status?: string;
  stages: PipelineStage[];
}

export interface PipelineStage {
  key: string;
  name: string;
  status?: string;
  durationMillis?: number;
  steps: PipelineStep[];
  parallelBranches: PipelineStage[];
}

export interface PipelineStep {
  key: string;
  name: string;
  status?: string;
  durationMillis?: number;
}
