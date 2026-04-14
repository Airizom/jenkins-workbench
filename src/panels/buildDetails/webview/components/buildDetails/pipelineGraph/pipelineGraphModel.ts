import type { PipelineStageViewModel } from "../../../../shared/BuildDetailsContracts";
import type {
  PipelineGraphEdgeModel,
  PipelineGraphModel,
  PipelineGraphNodeModel
} from "./pipelineGraphTypes";

const MIN_NODE_WIDTH = 140;
const MAX_NODE_WIDTH = 240;
const DEFAULT_NODE_WIDTH = 164;
const NODE_HEIGHT = 84;
const PARALLEL_NODE_HEIGHT = 94;

interface TraversalResult {
  entry: string;
  exits: string[];
}

interface RawNode {
  id: string;
  stage: PipelineStageViewModel;
  order: number;
}

export function buildPipelineGraphModel(stages: PipelineStageViewModel[]): PipelineGraphModel {
  const rawNodes: RawNode[] = [];
  const edges: PipelineGraphEdgeModel[] = [];
  const stageById = new Map<string, PipelineStageViewModel>();
  const orderedStageIds: string[] = [];
  const edgeIds = new Set<string>();
  const durationValues: number[] = [];
  let order = 0;

  const addEdge = (source: string, target: string, kind: PipelineGraphEdgeModel["kind"]): void => {
    const id = `${source}->${target}`;
    if (source === target || edgeIds.has(id)) {
      return;
    }
    edgeIds.add(id);
    edges.push({ id, source, target, kind });
  };

  const addStage = (stage: PipelineStageViewModel): TraversalResult => {
    const id = getStageNodeId(stage, order);
    if (typeof stage.durationMs === "number" && stage.durationMs >= 0) {
      durationValues.push(stage.durationMs);
    }
    rawNodes.push({
      id,
      stage,
      order: order++
    });
    stageById.set(id, stage);
    orderedStageIds.push(id);

    if (stage.parallelBranches.length === 0) {
      return { entry: id, exits: [id] };
    }

    const branchExits: string[] = [];
    for (const branch of stage.parallelBranches) {
      const branchResult = addStage(branch);
      addEdge(id, branchResult.entry, "parallel");
      branchExits.push(...branchResult.exits);
    }

    return {
      entry: id,
      exits: branchExits.length > 0 ? branchExits : [id]
    };
  };

  let previousExits: string[] = [];
  for (const stage of stages) {
    const current = addStage(stage);
    if (previousExits.length > 0) {
      for (const previous of previousExits) {
        addEdge(previous, current.entry, previousExits.length > 1 ? "join" : "sequential");
      }
    }
    previousExits = current.exits;
  }

  const nodes = rawNodes.map((node) =>
    toNodeModel(node, getDurationRatio(node.stage.durationMs, durationValues))
  );

  return {
    topologyKey: buildTopologyKey(stages),
    geometryKey: buildGeometryKey(nodes),
    nodes,
    edges,
    stageById,
    orderedStageIds
  };
}

function toNodeModel(rawNode: RawNode, durationRatio: number): PipelineGraphNodeModel {
  const width = resolveNodeWidth(rawNode.stage.durationMs, durationRatio);
  return {
    id: rawNode.id,
    stage: rawNode.stage,
    width,
    height: rawNode.stage.parallelBranches.length > 0 ? PARALLEL_NODE_HEIGHT : NODE_HEIGHT,
    durationMs: rawNode.stage.durationMs,
    durationRatio,
    order: rawNode.order
  };
}

function resolveNodeWidth(durationMs: number | undefined, durationRatio: number): number {
  if (typeof durationMs !== "number" || !Number.isFinite(durationMs)) {
    return DEFAULT_NODE_WIDTH;
  }
  return Math.round(MIN_NODE_WIDTH + durationRatio * (MAX_NODE_WIDTH - MIN_NODE_WIDTH));
}

function getDurationRatio(durationMs: number | undefined, allDurations: number[]): number {
  if (typeof durationMs !== "number" || !Number.isFinite(durationMs) || allDurations.length === 0) {
    return 0.24;
  }

  const loggedValues = allDurations.map((value) => Math.log(value + 1));
  const minLog = Math.min(...loggedValues);
  const maxLog = Math.max(...loggedValues);
  if (maxLog <= minLog) {
    return 0.5;
  }
  return (Math.log(durationMs + 1) - minLog) / (maxLog - minLog);
}

function getStageNodeId(stage: PipelineStageViewModel, fallbackIndex: number): string {
  const key = stage.key.trim();
  if (key.length > 0) {
    return key;
  }
  const name = stage.name.trim();
  if (name.length > 0) {
    return `stage:${name}:${fallbackIndex}`;
  }
  return `stage:${fallbackIndex}`;
}

function buildTopologyKey(stages: PipelineStageViewModel[]): string {
  return stages.map((stage, index) => buildStageTopologyKey(stage, index)).join("|");
}

function buildStageTopologyKey(stage: PipelineStageViewModel, index: number): string {
  const stageId = getStageNodeId(stage, index);
  if (stage.parallelBranches.length === 0) {
    return stageId;
  }
  return `${stageId}[${stage.parallelBranches
    .map((branch, branchIndex) => buildStageTopologyKey(branch, branchIndex))
    .join(",")}]`;
}

function buildGeometryKey(nodes: PipelineGraphNodeModel[]): string {
  return nodes.map((node) => `${node.id}:${node.width}x${node.height}`).join("|");
}
