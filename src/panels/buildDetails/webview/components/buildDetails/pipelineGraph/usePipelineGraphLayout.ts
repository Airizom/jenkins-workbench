import type { ElkExtendedEdge, ElkNode } from "elkjs/lib/elk-api";
import ELK from "elkjs/lib/elk.bundled.js";
import * as React from "react";
import type { PipelineStageViewModel } from "../../../../shared/BuildDetailsContracts";
import { buildPipelineGraphModel } from "./pipelineGraphModel";
import type {
  PipelineGraphLayoutEdge,
  PipelineGraphLayoutNode,
  PipelineGraphLayoutResult,
  PipelineGraphModel
} from "./pipelineGraphTypes";

const { useEffect, useMemo, useRef, useState } = React;

type PipelineGraphLayoutState =
  | { status: "idle"; model: PipelineGraphModel }
  | { status: "loading"; model: PipelineGraphModel }
  | { status: "ready"; layout: PipelineGraphLayoutResult }
  | { status: "error"; model: PipelineGraphModel; error: Error };

const elk = new ELK();

export function usePipelineGraphLayout(
  stages: PipelineStageViewModel[],
  enabled: boolean
): PipelineGraphLayoutState {
  const model = useMemo(
    () => (enabled ? buildPipelineGraphModel(stages) : createEmptyGraphModel()),
    [enabled, stages]
  );
  const previousLayoutRef = useRef<PipelineGraphLayoutResult | undefined>();
  const [state, setState] = useState<PipelineGraphLayoutState>(() =>
    enabled ? { status: "loading", model } : { status: "idle", model }
  );

  useEffect(() => {
    if (!enabled) {
      previousLayoutRef.current = undefined;
      setState({ status: "idle", model });
      return;
    }

    if (model.nodes.length === 0) {
      const emptyLayout = {
        status: "ready",
        layout: {
          width: 0,
          height: 0,
          model,
          nodes: [],
          edges: []
        }
      } satisfies PipelineGraphLayoutState;
      previousLayoutRef.current = emptyLayout.layout;
      setState(emptyLayout);
      return;
    }

    const previousLayout = previousLayoutRef.current;
    if (previousLayout && previousLayout.model.geometryKey === model.geometryKey) {
      const nextLayout = updateLayoutForModel(previousLayout, model);
      previousLayoutRef.current = nextLayout;
      setState({ status: "ready", layout: nextLayout });
      return;
    }

    let cancelled = false;
    setState({ status: "loading", model });

    void layoutPipelineGraph(model)
      .then((layout) => {
        if (cancelled) {
          return;
        }
        previousLayoutRef.current = layout;
        setState({ status: "ready", layout });
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        setState({
          status: "error",
          model,
          error: error instanceof Error ? error : new Error("Graph layout failed.")
        });
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, model]);

  return state;
}

function createEmptyGraphModel(): PipelineGraphModel {
  return {
    topologyKey: "",
    geometryKey: "",
    nodes: [],
    edges: [],
    stageById: new Map<string, PipelineStageViewModel>(),
    orderedStageIds: []
  };
}

async function layoutPipelineGraph(model: PipelineGraphModel): Promise<PipelineGraphLayoutResult> {
  const graph: ElkNode = {
    id: "pipeline-root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.padding": "[top=28,left=28,bottom=28,right=28]",
      "elk.spacing.nodeNode": "28",
      "elk.layered.spacing.nodeNodeBetweenLayers": "56",
      "elk.layered.spacing.edgeNodeBetweenLayers": "56",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
      "elk.layered.crossingMinimization.forceNodeModelOrder": "true",
      "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
      "elk.layered.nodePlacement.bk.fixedAlignment": "BALANCED"
    },
    children: model.nodes.map((node) => ({
      id: node.id,
      width: node.width,
      height: node.height
    })),
    edges: model.edges.map((edge) => ({
      id: edge.id,
      sources: [edge.source],
      targets: [edge.target]
    }))
  };

  const layout = await elk.layout(graph);
  const nodes = resolveLayoutNodes(layout, model);
  const nodeLookup = new Map(nodes.map((node) => [node.id, node]));
  const edges = resolveLayoutEdges(layout.edges ?? [], model, nodeLookup);

  return {
    width: layout.width ?? 0,
    height: layout.height ?? 0,
    model,
    nodes,
    edges
  };
}

function resolveLayoutNodes(layout: ElkNode, model: PipelineGraphModel): PipelineGraphLayoutNode[] {
  const nodeLookup = new Map(model.nodes.map((node) => [node.id, node]));
  return (layout.children ?? []).flatMap((child) => {
    const sourceNode = nodeLookup.get(child.id);
    if (!sourceNode) {
      return [];
    }
    return {
      ...sourceNode,
      x: child.x ?? 0,
      y: child.y ?? 0
    };
  });
}

function resolveLayoutEdges(
  layoutEdges: ElkExtendedEdge[],
  model: PipelineGraphModel,
  nodeLookup: Map<string, PipelineGraphLayoutNode>
): PipelineGraphLayoutEdge[] {
  const edgeLookup = new Map(model.edges.map((edge) => [edge.id, edge]));
  return layoutEdges.flatMap((layoutEdge) => {
    const sourceEdge = edgeLookup.get(layoutEdge.id);
    if (!sourceEdge) {
      return [];
    }

    const path = buildEdgePath(layoutEdge, sourceEdge, nodeLookup);
    if (!path) {
      throw new Error(`Layout returned an unroutable edge for ${layoutEdge.id}.`);
    }

    return {
      ...sourceEdge,
      path
    };
  });
}

function buildEdgePath(
  layoutEdge: ElkExtendedEdge,
  sourceEdge: PipelineGraphLayoutEdge | PipelineGraphModel["edges"][number],
  nodeLookup: Map<string, PipelineGraphLayoutNode>
): string | undefined {
  const section = layoutEdge.sections?.[0];
  if (section?.startPoint && section.endPoint) {
    const points = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint];
    return points
      .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
      .join(" ");
  }

  const sourceNode = nodeLookup.get(sourceEdge.source);
  const targetNode = nodeLookup.get(sourceEdge.target);
  if (!sourceNode || !targetNode) {
    return undefined;
  }

  const startX = sourceNode.x + sourceNode.width;
  const startY = sourceNode.y + sourceNode.height / 2;
  const endX = targetNode.x;
  const endY = targetNode.y + targetNode.height / 2;
  const midX = startX + (endX - startX) / 2;
  return `M ${startX} ${startY} L ${midX} ${startY} L ${midX} ${endY} L ${endX} ${endY}`;
}

function updateLayoutForModel(
  previousLayout: PipelineGraphLayoutResult,
  model: PipelineGraphModel
): PipelineGraphLayoutResult {
  const previousNodeLookup = new Map(previousLayout.nodes.map((node) => [node.id, node]));
  const nodes = model.nodes.flatMap((node) => {
    const previousNode = previousNodeLookup.get(node.id);
    if (!previousNode) {
      return [];
    }
    return {
      ...node,
      x: previousNode.x,
      y: previousNode.y
    };
  });
  const nodeLookup = new Map(nodes.map((node) => [node.id, node]));
  const edges = model.edges.flatMap((edge) => {
    const path = buildEdgePath(
      { id: edge.id, sources: [edge.source], targets: [edge.target] },
      edge,
      nodeLookup
    );
    if (!path) {
      return [];
    }
    return {
      ...edge,
      path
    };
  });

  return {
    width: Math.max(previousLayout.width, getLayoutWidth(nodes)),
    height: Math.max(previousLayout.height, getLayoutHeight(nodes)),
    model,
    nodes,
    edges
  };
}

function getLayoutWidth(nodes: PipelineGraphLayoutNode[]): number {
  if (nodes.length === 0) {
    return 0;
  }
  return Math.max(...nodes.map((node) => node.x + node.width)) + 28;
}

function getLayoutHeight(nodes: PipelineGraphLayoutNode[]): number {
  if (nodes.length === 0) {
    return 0;
  }
  return Math.max(...nodes.map((node) => node.y + node.height)) + 28;
}
