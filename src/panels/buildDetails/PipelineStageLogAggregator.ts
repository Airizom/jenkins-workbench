import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import type { JenkinsWorkflowStage, JenkinsWorkflowStep } from "../../jenkins/types";
import type { BuildDetailsConsoleBackend } from "./BuildDetailsBackend";
import { escapeHtml, uniqueStrings } from "./PipelineNodeLogContent";
import type {
  PipelineLogTargetViewModel,
  PipelineNodeLogViewModel
} from "./shared/BuildDetailsContracts";

const MAX_AGGREGATED_NODE_COUNT = 25;
const MAX_AGGREGATED_NODE_FETCHES_PER_POLL = 6;

interface AggregatedNodeLogSnapshot {
  html: string;
  text: string;
  hasMore: boolean;
  consoleUrl?: string;
}

interface StageChildNodeSnapshot {
  nodeIds: string[];
  complete: boolean;
}

export interface PipelineStageLogAggregatorOptions {
  backend: BuildDetailsConsoleBackend;
  environment: JenkinsEnvironmentRef;
  buildUrl: string;
}

export class PipelineStageLogAggregator {
  private readonly nodeCache = new Map<string, AggregatedNodeLogSnapshot>();
  private readonly childNodeIdsCache = new Map<string, StageChildNodeSnapshot>();
  private fetchCursor = 0;

  constructor(private readonly options: PipelineStageLogAggregatorOptions) {}

  reset(): void {
    this.nodeCache.clear();
    this.childNodeIdsCache.clear();
    this.resetCursor();
  }

  resetCursor(): void {
    this.fetchCursor = 0;
  }

  async fetch(
    target: PipelineLogTargetViewModel,
    initial: boolean
  ): Promise<PipelineNodeLogViewModel> {
    const nodeIds = await this.resolveStageNodeIds(target);
    const selectedNodeIds =
      nodeIds.length > MAX_AGGREGATED_NODE_COUNT
        ? nodeIds.slice(0, MAX_AGGREGATED_NODE_COUNT)
        : nodeIds;
    const omittedNodeCount = Math.max(0, nodeIds.length - selectedNodeIds.length);
    const refreshCandidates = selectedNodeIds.filter((nodeId) => {
      const cached = this.nodeCache.get(nodeId);
      return initial ? !cached : !cached || cached.hasMore;
    });
    const nodesToFetch = this.takeRefreshBatch(refreshCandidates);

    for (const nodeId of nodesToFetch) {
      const snapshot = await this.options.backend.getFlowNodeLog(
        this.options.environment,
        this.options.buildUrl,
        nodeId
      );
      if (!snapshot) {
        this.nodeCache.set(nodeId, {
          html: "",
          text: "",
          hasMore: false
        });
        continue;
      }
      const text = snapshot.text ?? "";
      this.nodeCache.set(nodeId, {
        html: escapeHtml(text),
        text,
        hasMore: Boolean(snapshot.hasMore),
        consoleUrl: snapshot.consoleUrl
      });
    }

    return this.buildLog(target, selectedNodeIds, omittedNodeCount);
  }

  private buildLog(
    target: PipelineLogTargetViewModel,
    selectedNodeIds: string[],
    omittedNodeCount: number
  ): PipelineNodeLogViewModel {
    const parts: string[] = [];
    const textParts: string[] = [];
    let truncated = false;
    let consoleUrl: string | undefined;
    let pendingNodeCount = 0;
    let hasMoreNodeData = false;

    for (const nodeId of selectedNodeIds) {
      const snapshot = this.nodeCache.get(nodeId);
      if (!snapshot) {
        pendingNodeCount += 1;
        continue;
      }
      const header = `Node ${nodeId}`;
      parts.push(`<div class="pipeline-node-log-divider">${escapeHtml(header)}</div>`);
      parts.push(snapshot.html);
      textParts.push(`===== ${header} =====\n${snapshot.text}`);
      truncated = truncated || Boolean(snapshot.hasMore);
      hasMoreNodeData = hasMoreNodeData || Boolean(snapshot.hasMore);
      consoleUrl = consoleUrl ?? snapshot.consoleUrl;
    }

    if (omittedNodeCount > 0) {
      const note = `Showing first ${MAX_AGGREGATED_NODE_COUNT} pipeline nodes; ${omittedNodeCount} additional nodes were omitted to limit Jenkins API fan-out.`;
      parts.push(`<div class="pipeline-node-log-divider">${escapeHtml(note)}</div>`);
      textParts.push(note);
      truncated = true;
    }

    if (pendingNodeCount > 0) {
      const note = `Loading ${pendingNodeCount} remaining pipeline node logs.`;
      parts.push(`<div class="pipeline-node-log-divider">${escapeHtml(note)}</div>`);
      textParts.push(note);
    }

    return {
      target,
      html: parts.join(""),
      text: textParts.join("\n\n"),
      truncated,
      loading: pendingNodeCount > 0,
      polling:
        pendingNodeCount > 0 || hasMoreNodeData || this.isStageChildDiscoveryIncomplete(target),
      consoleUrl
    };
  }

  private isStageChildDiscoveryIncomplete(target: PipelineLogTargetViewModel): boolean {
    if (!target.nodeId) {
      return false;
    }
    const cached = this.childNodeIdsCache.get(target.nodeId);
    return cached ? !cached.complete : true;
  }

  private async resolveStageNodeIds(target: PipelineLogTargetViewModel): Promise<string[]> {
    const explicitChildNodeIds = uniqueStrings(target.childNodeIds ?? []);
    if (!target.nodeId) {
      return explicitChildNodeIds;
    }

    const discoveredChildNodeIds = await this.discoverChildNodeIds(target.nodeId);
    const childNodeIds = uniqueStrings([...explicitChildNodeIds, ...discoveredChildNodeIds]);
    if (childNodeIds.length > 0) {
      return childNodeIds;
    }

    return [target.nodeId];
  }

  private async discoverChildNodeIds(nodeId: string): Promise<string[]> {
    const cached = this.childNodeIdsCache.get(nodeId);
    if (cached?.complete) {
      return cached.nodeIds;
    }

    const details = await this.options.backend.getFlowNodeDetails(
      this.options.environment,
      this.options.buildUrl,
      nodeId
    );
    const childNodeIds = details ? collectFlowNodeChildIds(details) : [];
    const mergedChildNodeIds = uniqueStrings([...(cached?.nodeIds ?? []), ...childNodeIds]);
    this.childNodeIdsCache.set(nodeId, {
      nodeIds: mergedChildNodeIds,
      complete: details ? isWorkflowNodeComplete(details) : true
    });
    return mergedChildNodeIds;
  }

  private takeRefreshBatch(candidates: string[]): string[] {
    if (candidates.length <= MAX_AGGREGATED_NODE_FETCHES_PER_POLL) {
      this.fetchCursor = 0;
      return candidates;
    }
    const start = this.fetchCursor % candidates.length;
    const batch: string[] = [];
    for (let index = 0; index < MAX_AGGREGATED_NODE_FETCHES_PER_POLL; index += 1) {
      batch.push(candidates[(start + index) % candidates.length]);
    }
    this.fetchCursor = (start + batch.length) % candidates.length;
    return batch;
  }
}

function isWorkflowNodeComplete(node: JenkinsWorkflowStage | undefined): boolean {
  const status = node?.status?.trim().toUpperCase();
  return Boolean(
    status &&
      status !== "IN_PROGRESS" &&
      status !== "PAUSED_PENDING_INPUT" &&
      status !== "QUEUED" &&
      status !== "NOT_STARTED"
  );
}

function collectFlowNodeChildIds(node: JenkinsWorkflowStage | JenkinsWorkflowStep): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();

  for (const step of collectFlowNodeSteps(node)) {
    collectFlowNodeChildIdsFromChild(step, ids, seen);
  }
  for (const stage of collectFlowNodeBranches(node)) {
    collectFlowNodeChildIdsFromChild(stage, ids, seen);
  }

  return ids;
}

function collectFlowNodeChildIdsFromChild(
  node: JenkinsWorkflowStage | JenkinsWorkflowStep,
  ids: string[],
  seen: Set<string>
): void {
  addFlowNodeId(node.id, ids, seen);

  for (const step of collectFlowNodeSteps(node)) {
    collectFlowNodeChildIdsFromChild(step, ids, seen);
  }
  for (const stage of collectFlowNodeBranches(node)) {
    collectFlowNodeChildIdsFromChild(stage, ids, seen);
  }
}

function addFlowNodeId(id: string | undefined, ids: string[], seen: Set<string>): void {
  const trimmed = id?.trim();
  if (!trimmed || seen.has(trimmed)) {
    return;
  }
  seen.add(trimmed);
  ids.push(trimmed);
}

function collectFlowNodeSteps(
  node: JenkinsWorkflowStage | JenkinsWorkflowStep
): JenkinsWorkflowStep[] {
  if (Array.isArray(node.stageFlowNodes)) {
    return node.stageFlowNodes;
  }
  if (Array.isArray(node.steps)) {
    return node.steps;
  }
  return [];
}

function collectFlowNodeBranches(
  node: JenkinsWorkflowStage | JenkinsWorkflowStep
): JenkinsWorkflowStage[] {
  if (Array.isArray(node.parallelStages)) {
    return node.parallelStages;
  }
  if (Array.isArray(node.branches)) {
    return node.branches;
  }
  if (Array.isArray(node.children)) {
    return node.children;
  }
  return [];
}
