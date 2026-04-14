import type { PipelineStageViewModel } from "../../../../shared/BuildDetailsContracts";

export type PipelinePresentation = "graph" | "list";

export interface PipelineGraphNodeModel {
  id: string;
  stage: PipelineStageViewModel;
  width: number;
  height: number;
  durationMs?: number;
  durationRatio: number;
  order: number;
}

export interface PipelineGraphEdgeModel {
  id: string;
  source: string;
  target: string;
  kind: "sequential" | "parallel" | "join";
}

export interface PipelineGraphModel {
  topologyKey: string;
  geometryKey: string;
  nodes: PipelineGraphNodeModel[];
  edges: PipelineGraphEdgeModel[];
  stageById: Map<string, PipelineStageViewModel>;
  orderedStageIds: string[];
}

export interface PipelineGraphLayoutNode extends PipelineGraphNodeModel {
  x: number;
  y: number;
}

export interface PipelineGraphLayoutEdge extends PipelineGraphEdgeModel {
  path: string;
}

export interface PipelineGraphLayoutResult {
  width: number;
  height: number;
  model: PipelineGraphModel;
  nodes: PipelineGraphLayoutNode[];
  edges: PipelineGraphLayoutEdge[];
}
