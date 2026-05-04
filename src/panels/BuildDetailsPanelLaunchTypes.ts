export interface PipelineNodeSelection {
  kind: "stage" | "step";
  nodeId: string;
  name?: string;
}
