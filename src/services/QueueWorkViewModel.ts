import { formatDurationMs } from "../formatters/DurationFormatters";
import type { JenkinsQueueItemInfo } from "../jenkins/JenkinsDataService";
import type {
  NodeQueuedWorkViewModel,
  QueueWorkItemViewModel
} from "../shared/queueWork/QueueWorkContracts";
import type { NodeLabelClassification, NodeLabelInput } from "./NodeLabelClassification";
import { classifyNodeLabels, normalizeLabelKey } from "./NodeLabelClassification";

export interface QueueWorkBuildOptions {
  nodes?: NodeLabelInput[];
}

export function buildQueueWorkItemViewModel(
  item: JenkinsQueueItemInfo,
  options?: QueueWorkBuildOptions
): QueueWorkItemViewModel {
  const queuedForLabels = resolveQueuedForLabels(item, options);
  return {
    id: item.id,
    name: item.name,
    position: item.position,
    statusLabel: formatQueueStatus(item),
    reason: item.reason,
    queuedForLabel: queuedForLabels[0],
    queuedForLabels,
    inQueueSince: item.inQueueSince,
    queuedDurationLabel: formatQueueDuration(item.inQueueSince),
    taskUrl: item.taskUrl,
    blocked: item.blocked === true,
    buildable: item.buildable === true,
    stuck: item.stuck === true
  };
}

export function buildQueueWorkItems(
  items: JenkinsQueueItemInfo[],
  options?: QueueWorkBuildOptions
): QueueWorkItemViewModel[] {
  return items.map((item) => buildQueueWorkItemViewModel(item, options));
}

export function buildNodeQueuedWorkViewModel(
  queueItems: QueueWorkItemViewModel[],
  labels: NodeLabelClassification
): NodeQueuedWorkViewModel {
  return {
    matchingQueueItems: queueItems.filter((item) => hasMatchingLabel(item, labels.poolLabelSet)),
    anyQueueItems: queueItems.filter((item) => item.queuedForLabels.length === 0),
    selfLabelQueueItems: queueItems.filter((item) => hasMatchingLabel(item, labels.hiddenLabelSet))
  };
}

function resolveQueuedForLabels(
  item: JenkinsQueueItemInfo,
  options: QueueWorkBuildOptions | undefined
): string[] {
  const assignedLabel = trimToUndefined(item.assignedLabelName);
  if (assignedLabel) {
    return [assignedLabel];
  }
  return inferQueuedLabelsFromBlockedNodeReason(item.reason, options?.nodes);
}

function hasMatchingLabel(item: QueueWorkItemViewModel, labelKeys: Set<string>): boolean {
  return item.queuedForLabels.some((label) => labelKeys.has(normalizeLabelKey(label)));
}

function formatQueueStatus(item: JenkinsQueueItemInfo): string {
  if (item.stuck) {
    return "Stuck";
  }
  if (item.blocked) {
    return "Blocked";
  }
  if (item.buildable) {
    return "Buildable";
  }
  return "Waiting";
}

function formatQueueDuration(inQueueSince?: number): string | undefined {
  if (typeof inQueueSince !== "number" || !Number.isFinite(inQueueSince)) {
    return undefined;
  }
  return formatDurationMs(Math.max(0, Date.now() - inQueueSince));
}

function inferQueuedLabelsFromBlockedNodeReason(
  reason: string | undefined,
  nodes: NodeLabelInput[] | undefined
): string[] {
  if (!reason || !Array.isArray(nodes) || nodes.length === 0) {
    return [];
  }

  const labelsByNodeName = buildPoolLabelsByNodeName(nodes);
  const nodeNamePattern = /['"‘’]([^'"‘’]+)['"‘’]\s+is offline/gi;
  const labels: string[] = [];
  const seenLabelKeys = new Set<string>();
  let match = nodeNamePattern.exec(reason);
  while (match !== null) {
    for (const label of labelsByNodeName.get(normalizeLabelKey(match[1])) ?? []) {
      const key = normalizeLabelKey(label);
      if (!seenLabelKeys.has(key)) {
        seenLabelKeys.add(key);
        labels.push(label);
      }
    }
    match = nodeNamePattern.exec(reason);
  }
  return labels;
}

function buildPoolLabelsByNodeName(nodes: NodeLabelInput[]): Map<string, string[]> {
  const labelsByNodeName = new Map<string, string[]>();
  for (const node of nodes) {
    const labels = classifyNodeLabels(node).poolLabels;
    if (labels.length === 0) {
      continue;
    }
    for (const name of [node.name, node.displayName]) {
      const key = normalizeLabelKey(name);
      if (key) {
        labelsByNodeName.set(key, labels);
      }
    }
  }
  return labelsByNodeName;
}

function trimToUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
