import { formatEnvironmentLabel } from "../jenkins/EnvironmentLabels";
import type { JenkinsNodeInfo, JenkinsQueueItemInfo } from "../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import { buildBaseNodeExecutorSummaries } from "../jenkins/NodeExecutorFormatters";
import {
  formatNodeBusyExecutorRatio,
  formatNodeOfflineReason,
  formatNodeStatusLabel,
  resolveBusyExecutors
} from "../jenkins/NodeFormatters";
import type { JenkinsNodeDetails } from "../jenkins/types";
import type {
  NodeCapacityExecutorViewModel,
  NodeCapacityNodeViewModel,
  NodeCapacityOfflineImpactViewModel,
  NodeCapacityPoolViewModel,
  NodeCapacitySeverity,
  NodeCapacitySummaryViewModel,
  NodeCapacityViewModel
} from "../shared/nodeCapacity/NodeCapacityContracts";
import { toNonNegativeInteger } from "../shared/numbers";
import type { QueueWorkItemViewModel } from "../shared/queueWork/QueueWorkContracts";
import { firstNonEmpty } from "../shared/stringValues";
import {
  classifyNodeLabels,
  type NodeLabelClassification,
  normalizeLabelKey
} from "./NodeLabelClassification";
import { buildNodeQueuedWorkViewModel, buildQueueWorkItems } from "./QueueWorkViewModel";

const ANY_POOL_ID = "pool:any";
const ANY_POOL_LABEL = "Any executor";

interface ClassifiedNode {
  node: JenkinsNodeInfo;
  labels: NodeLabelClassification;
}

export function buildNodeCapacityViewModel(
  environment: JenkinsEnvironmentRef,
  nodes: JenkinsNodeInfo[],
  queueItems: JenkinsQueueItemInfo[],
  updatedAt: string
): NodeCapacityViewModel {
  const queueViewModels = buildQueueWorkItems(queueItems, { nodes });
  const anyQueueItems = queueViewModels.filter((item) => item.queuedForLabels.length === 0);
  const classifiedNodes = nodes.map((node) => ({ node, labels: classifyNodeLabels(node) }));
  const hiddenLabelKeys = buildHiddenLabelKeySet(classifiedNodes);
  const poolLabels = collectPoolLabels(classifiedNodes, queueViewModels, hiddenLabelKeys);
  const nodeViewModels = classifiedNodes.map(({ node, labels }) =>
    buildNodeViewModel(node, labels, queueViewModels)
  );
  const nodeViewModelsByLabel = buildNodeViewModelsByLabel(nodeViewModels);
  const queueItemsByLabel = groupQueueItemsByLabel(queueViewModels, hiddenLabelKeys);

  const pools = [
    buildPool({
      id: ANY_POOL_ID,
      label: ANY_POOL_LABEL,
      kind: "any",
      nodes: nodeViewModels,
      queueItems: anyQueueItems
    }),
    ...poolLabels.map((label) => {
      const key = normalizeLabelKey(label);
      return buildPool({
        id: `pool:label:${label}`,
        label,
        kind: "label",
        nodes: nodeViewModelsByLabel.get(key) ?? [],
        queueItems: queueItemsByLabel.get(key) ?? []
      });
    })
  ].sort(comparePools);

  return {
    environmentLabel: formatEnvironmentLabel(environment.url),
    updatedAt,
    summary: buildSummary(nodeViewModels, queueViewModels, pools),
    pools,
    hiddenLabelQueueItems: queueViewModels.filter((item) =>
      item.queuedForLabels.some((label) => hiddenLabelKeys.has(normalizeLabelKey(label)))
    ),
    errors: [],
    loading: false
  };
}

export function buildNodeCapacityExecutorViewModels(
  details: JenkinsNodeDetails
): NodeCapacityExecutorViewModel[] {
  return [
    ...buildBaseNodeExecutorSummaries(details.executors, "Executor"),
    ...buildBaseNodeExecutorSummaries(details.oneOffExecutors, "One-off")
  ].map((executor) => ({ ...executor }));
}

function buildNodeViewModel(
  node: JenkinsNodeInfo,
  labels: NodeLabelClassification,
  queueItems: QueueWorkItemViewModel[]
): NodeCapacityNodeViewModel {
  const totalExecutors = toNonNegativeInteger(node.numExecutors);
  const busyExecutors = resolveBusyExecutors(node, totalExecutors);
  const isOffline = node.offline === true;
  const idleExecutors = isOffline ? 0 : Math.max(0, totalExecutors - busyExecutors);
  const offlineExecutors = isOffline ? totalExecutors : 0;
  const displayName = firstNonEmpty(node.displayName, node.name) ?? "Unknown node";
  const name = firstNonEmpty(node.name, node.displayName) ?? displayName;

  return {
    displayName,
    name,
    nodeUrl: node.nodeUrl,
    statusLabel: formatNodeStatusLabel(node),
    isOffline,
    isTemporarilyOffline: node.temporarilyOffline === true,
    offlineReason: formatNodeOfflineReason(node),
    labels: labels.allLabels,
    poolLabels: labels.poolLabels,
    hiddenLabels: labels.hiddenLabels,
    totalExecutors,
    busyExecutors,
    idleExecutors,
    offlineExecutors,
    executorSummary: formatNodeBusyExecutorRatio(node, { suffix: " busy" }) ?? "Online",
    executorsLoaded: false,
    executors: [],
    ...buildNodeQueuedWorkViewModel(queueItems, labels)
  };
}

function buildPool(input: {
  id: string;
  label: string;
  kind: NodeCapacityPoolViewModel["kind"];
  nodes: NodeCapacityNodeViewModel[];
  queueItems: QueueWorkItemViewModel[];
}): NodeCapacityPoolViewModel {
  const nodeTotals = aggregateNodeCapacity(input.nodes, {
    includeOfflineExecutorsInTotals: true
  });
  const queueTotals = aggregateQueueItems(input.queueItems);
  const severity = resolvePoolSeverity(
    queueTotals.queuedCount,
    queueTotals.stuckCount,
    nodeTotals.idleExecutors,
    nodeTotals.offlineExecutors
  );

  return {
    ...input,
    severity,
    statusLabel: formatPoolStatus(severity, queueTotals.queuedCount, nodeTotals.idleExecutors),
    offlineImpact: buildOfflineImpact(input.nodes),
    ...nodeTotals,
    ...queueTotals
  };
}

function buildSummary(
  nodes: NodeCapacityNodeViewModel[],
  queueItems: QueueWorkItemViewModel[],
  pools: NodeCapacityPoolViewModel[]
): NodeCapacitySummaryViewModel {
  return {
    ...aggregateNodeCapacity(nodes, { includeOfflineExecutorsInTotals: false }),
    ...aggregateQueueItems(queueItems),
    bottleneckCount: pools.filter((pool) => pool.severity !== "normal").length
  };
}

function aggregateNodeCapacity(
  nodes: NodeCapacityNodeViewModel[],
  options: { includeOfflineExecutorsInTotals: boolean }
): Pick<
  NodeCapacitySummaryViewModel,
  | "totalNodes"
  | "onlineNodes"
  | "offlineNodes"
  | "totalExecutors"
  | "busyExecutors"
  | "idleExecutors"
  | "offlineExecutors"
> {
  let onlineNodes = 0;
  let totalExecutors = 0;
  let busyExecutors = 0;
  let idleExecutors = 0;
  let offlineExecutors = 0;
  for (const node of nodes) {
    if (node.isOffline) {
      offlineExecutors += node.offlineExecutors;
      if (!options.includeOfflineExecutorsInTotals) {
        continue;
      }
    } else {
      onlineNodes += 1;
    }
    totalExecutors += node.totalExecutors;
    busyExecutors += node.busyExecutors;
    idleExecutors += node.idleExecutors;
  }
  return {
    totalNodes: nodes.length,
    onlineNodes,
    offlineNodes: nodes.length - onlineNodes,
    totalExecutors,
    busyExecutors,
    idleExecutors,
    offlineExecutors
  };
}

function aggregateQueueItems(
  queueItems: QueueWorkItemViewModel[]
): Pick<
  NodeCapacitySummaryViewModel,
  "queuedCount" | "stuckCount" | "blockedCount" | "buildableCount"
> {
  let stuckCount = 0;
  let blockedCount = 0;
  let buildableCount = 0;
  for (const item of queueItems) {
    if (item.stuck) {
      stuckCount += 1;
    }
    if (item.blocked) {
      blockedCount += 1;
    }
    if (item.buildable) {
      buildableCount += 1;
    }
  }
  return {
    queuedCount: queueItems.length,
    stuckCount,
    blockedCount,
    buildableCount
  };
}

function buildOfflineImpact(
  nodes: NodeCapacityNodeViewModel[]
): NodeCapacityOfflineImpactViewModel[] {
  const offlineImpact: NodeCapacityOfflineImpactViewModel[] = [];
  for (const node of nodes) {
    if (node.isOffline && node.offlineExecutors > 0) {
      offlineImpact.push({
        nodeName: node.displayName,
        nodeUrl: node.nodeUrl,
        executors: node.offlineExecutors,
        reason: node.offlineReason
      });
    }
  }
  return offlineImpact;
}

function buildHiddenLabelKeySet(nodes: ClassifiedNode[]): Set<string> {
  const hiddenKeys = new Set<string>();
  const poolKeys = new Set<string>();
  for (const { labels } of nodes) {
    for (const label of labels.poolLabels) {
      poolKeys.add(normalizeLabelKey(label));
    }
    for (const label of labels.hiddenLabels) {
      hiddenKeys.add(normalizeLabelKey(label));
    }
  }
  for (const key of poolKeys) {
    hiddenKeys.delete(key);
  }
  return hiddenKeys;
}

function collectPoolLabels(
  nodes: ClassifiedNode[],
  queueItems: QueueWorkItemViewModel[],
  hiddenLabelKeys: Set<string>
): string[] {
  const labelsByKey = new Map<string, string>();
  for (const { labels } of nodes) {
    for (const label of labels.poolLabels) {
      labelsByKey.set(normalizeLabelKey(label), label);
    }
  }
  for (const item of queueItems) {
    for (const label of item.queuedForLabels) {
      const key = normalizeLabelKey(label);
      if (!hiddenLabelKeys.has(key)) {
        labelsByKey.set(key, label);
      }
    }
  }
  return [...labelsByKey.values()];
}

function buildNodeViewModelsByLabel(
  nodes: NodeCapacityNodeViewModel[]
): Map<string, NodeCapacityNodeViewModel[]> {
  const grouped = new Map<string, NodeCapacityNodeViewModel[]>();
  for (const node of nodes) {
    for (const label of node.poolLabels) {
      const key = normalizeLabelKey(label);
      getOrCreateGroup(grouped, key).push(node);
    }
  }
  return grouped;
}

function groupQueueItemsByLabel(
  queueItems: QueueWorkItemViewModel[],
  hiddenLabelKeys: Set<string>
): Map<string, QueueWorkItemViewModel[]> {
  const grouped = new Map<string, QueueWorkItemViewModel[]>();
  for (const item of queueItems) {
    for (const label of item.queuedForLabels) {
      const key = normalizeLabelKey(label);
      if (hiddenLabelKeys.has(key)) {
        continue;
      }
      getOrCreateGroup(grouped, key).push(item);
    }
  }
  return grouped;
}

function getOrCreateGroup<TKey, TValue>(map: Map<TKey, TValue[]>, key: TKey): TValue[] {
  const existing = map.get(key);
  if (existing) {
    return existing;
  }
  const created: TValue[] = [];
  map.set(key, created);
  return created;
}

function resolvePoolSeverity(
  queuedCount: number,
  stuckCount: number,
  idleExecutors: number,
  offlineExecutors: number
): NodeCapacitySeverity {
  if (stuckCount > 0 || (queuedCount > 0 && idleExecutors === 0)) {
    return "critical";
  }
  if (queuedCount > 0 || offlineExecutors > 0) {
    return "warning";
  }
  return "normal";
}

function comparePools(left: NodeCapacityPoolViewModel, right: NodeCapacityPoolViewModel): number {
  const scoreDelta = scorePool(right) - scorePool(left);
  if (scoreDelta !== 0) {
    return scoreDelta;
  }
  if (left.kind !== right.kind) {
    return left.kind === "any" ? -1 : 1;
  }
  return left.label.localeCompare(right.label);
}

function scorePool(pool: NodeCapacityPoolViewModel): number {
  const severityScore =
    pool.severity === "critical" ? 10_000 : pool.severity === "warning" ? 1_000 : 0;
  return (
    severityScore +
    pool.stuckCount * 100 +
    pool.queuedCount * 20 +
    (pool.idleExecutors === 0 && pool.queuedCount > 0 ? 50 : 0) +
    pool.offlineExecutors
  );
}

function formatPoolStatus(
  severity: NodeCapacitySeverity,
  queuedCount: number,
  idleExecutors: number
): string {
  if (severity === "critical") {
    return queuedCount > 0 && idleExecutors === 0 ? "Blocked capacity" : "Stuck queue";
  }
  if (queuedCount > 0) {
    return "Queue pressure";
  }
  if (severity === "warning") {
    return "Reduced capacity";
  }
  return "Available";
}
