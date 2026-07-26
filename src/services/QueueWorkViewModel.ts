import { formatQueueDuration } from "../formatters/DurationFormatters";
import type { JenkinsQueueItemInfo } from "../jenkins/JenkinsDataService";
import type {
  NodeQueuedWorkViewModel,
  QueueWorkItemViewModel
} from "../shared/queueWork/QueueWorkContracts";
import { trimToUndefined } from "../shared/stringValues";
import type { NodeLabelClassification, NodeLabelInput } from "./NodeLabelClassification";
import { classifyNodeLabels, normalizeLabelKey } from "./NodeLabelClassification";

export interface QueueWorkBuildOptions {
  nodes?: NodeLabelInput[];
}

interface QueueWorkBuildContext {
  nodes?: NodeLabelInput[];
  labelsByNodeName?: Map<string, string[]>;
}

function buildQueueWorkItemViewModel(
  item: JenkinsQueueItemInfo,
  context: QueueWorkBuildContext
): QueueWorkItemViewModel {
  const queuedForLabels = resolveQueuedForLabels(item, context);
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
  const context: QueueWorkBuildContext = { nodes: options?.nodes };
  return items.map((item) => buildQueueWorkItemViewModel(item, context));
}

export function buildNodeQueuedWorkViewModel(
  queueItems: QueueWorkItemViewModel[],
  labels: NodeLabelClassification
): NodeQueuedWorkViewModel {
  const matchingQueueItems: QueueWorkItemViewModel[] = [];
  const anyQueueItems: QueueWorkItemViewModel[] = [];
  const selfLabelQueueItems: QueueWorkItemViewModel[] = [];
  for (const item of queueItems) {
    if (hasMatchingLabel(item, labels.poolLabelSet)) {
      matchingQueueItems.push(item);
    }
    if (item.queuedForLabels.length === 0) {
      anyQueueItems.push(item);
    }
    if (hasMatchingLabel(item, labels.hiddenLabelSet)) {
      selfLabelQueueItems.push(item);
    }
  }
  return {
    matchingQueueItems,
    anyQueueItems,
    selfLabelQueueItems
  };
}

function resolveQueuedForLabels(
  item: JenkinsQueueItemInfo,
  context: QueueWorkBuildContext
): string[] {
  const assignedLabel = trimToUndefined(item.assignedLabelName);
  if (assignedLabel) {
    return [assignedLabel];
  }
  if (!item.reason || !Array.isArray(context.nodes) || context.nodes.length === 0) {
    return [];
  }
  context.labelsByNodeName ??= buildPoolLabelsByNodeName(context.nodes);
  return inferQueuedLabelsFromBlockedNodeReason(item.reason, context.labelsByNodeName);
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

function inferQueuedLabelsFromBlockedNodeReason(
  reason: string | undefined,
  labelsByNodeName: ReadonlyMap<string, string[]>
): string[] {
  if (!reason) {
    return [];
  }

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
