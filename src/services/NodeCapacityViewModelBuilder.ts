import { formatEnvironmentLabel } from "../jenkins/EnvironmentLabels";
import type { JenkinsNodeInfo, JenkinsQueueItemInfo } from "../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import type { JenkinsNodeDetails, JenkinsNodeExecutor } from "../jenkins/types";
import type {
  NodeCapacityExecutorViewModel,
  NodeCapacityNodeViewModel,
  NodeCapacityOfflineImpactViewModel,
  NodeCapacityPoolViewModel,
  NodeCapacitySeverity,
  NodeCapacitySummaryViewModel,
  NodeCapacityViewModel
} from "../shared/nodeCapacity/NodeCapacityContracts";
import type { QueueWorkItemViewModel } from "../shared/queueWork/QueueWorkContracts";
import { firstNonEmpty } from "../shared/stringValues";
import { classifyNodeLabels, normalizeLabelKey } from "./NodeLabelClassification";
import { buildNodeQueuedWorkViewModel, buildQueueWorkItems } from "./QueueWorkViewModel";

const ANY_POOL_ID = "pool:any";
const ANY_POOL_LABEL = "Any executor";

export function buildNodeCapacityViewModel(
  environment: JenkinsEnvironmentRef,
  nodes: JenkinsNodeInfo[],
  queueItems: JenkinsQueueItemInfo[],
  updatedAt: string
): NodeCapacityViewModel {
  const queueViewModels = buildQueueWorkItems(queueItems, { nodes });
  const anyQueueItems = queueViewModels.filter((item) => item.queuedForLabels.length === 0);
  const hiddenLabelKeys = buildHiddenLabelKeySet(nodes);
  const poolLabels = collectPoolLabels(nodes, queueViewModels, hiddenLabelKeys);
  const nodeViewModels = nodes.map((node) => buildNodeViewModel(node, queueViewModels));
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
    ...poolLabels.map((label) =>
      buildPool({
        id: `pool:label:${label}`,
        label,
        kind: "label",
        nodes: nodeViewModelsByLabel.get(normalizeLabelKey(label)) ?? [],
        queueItems: queueItemsByLabel.get(normalizeLabelKey(label)) ?? []
      })
    )
  ].sort(comparePools);

  return {
    environmentLabel: formatEnvironmentLabel(environment.url),
    updatedAt,
    summary: buildSummary(nodes, queueViewModels, pools),
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
    ...buildExecutorGroup(details.executors, "Executor"),
    ...buildExecutorGroup(details.oneOffExecutors, "One-off")
  ];
}

function buildNodeViewModel(
  node: JenkinsNodeInfo,
  queueItems: QueueWorkItemViewModel[]
): NodeCapacityNodeViewModel {
  const labels = classifyNodeLabels(node);
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
    statusLabel: formatNodeStatus(node),
    isOffline,
    isTemporarilyOffline: node.temporarilyOffline === true,
    offlineReason: formatOfflineReason(node),
    labels: labels.allLabels,
    poolLabels: labels.poolLabels,
    hiddenLabels: labels.hiddenLabels,
    totalExecutors,
    busyExecutors,
    idleExecutors,
    offlineExecutors,
    executorSummary: `${busyExecutors}/${totalExecutors} busy`,
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
  const totalNodes = input.nodes.length;
  const onlineNodes = input.nodes.filter((node) => !node.isOffline).length;
  const offlineNodes = totalNodes - onlineNodes;
  const totalExecutors = sumBy(input.nodes, (node) => node.totalExecutors);
  const busyExecutors = sumBy(input.nodes, (node) => node.busyExecutors);
  const idleExecutors = sumBy(input.nodes, (node) => node.idleExecutors);
  const offlineExecutors = sumBy(input.nodes, (node) => node.offlineExecutors);
  const stuckCount = input.queueItems.filter((item) => item.stuck).length;
  const blockedCount = input.queueItems.filter((item) => item.blocked).length;
  const buildableCount = input.queueItems.filter((item) => item.buildable).length;
  const severity = resolvePoolSeverity(
    input.queueItems.length,
    stuckCount,
    idleExecutors,
    offlineExecutors
  );

  return {
    ...input,
    severity,
    statusLabel: formatPoolStatus(severity, input.queueItems.length, idleExecutors),
    offlineImpact: buildOfflineImpact(input.nodes),
    totalNodes,
    onlineNodes,
    offlineNodes,
    totalExecutors,
    busyExecutors,
    idleExecutors,
    offlineExecutors,
    queuedCount: input.queueItems.length,
    stuckCount,
    blockedCount,
    buildableCount
  };
}

function buildSummary(
  nodes: JenkinsNodeInfo[],
  queueItems: QueueWorkItemViewModel[],
  pools: NodeCapacityPoolViewModel[]
): NodeCapacitySummaryViewModel {
  const onlineNodes = nodes.filter((node) => node.offline !== true).length;
  const totals = nodes.reduce(
    (current, node) => {
      const totalExecutors = toNonNegativeInteger(node.numExecutors);
      const busyExecutors = resolveBusyExecutors(node, totalExecutors);
      if (node.offline === true) {
        current.offlineExecutors += totalExecutors;
      } else {
        current.totalExecutors += totalExecutors;
        current.busyExecutors += busyExecutors;
        current.idleExecutors += Math.max(0, totalExecutors - busyExecutors);
      }
      return current;
    },
    { totalExecutors: 0, busyExecutors: 0, idleExecutors: 0, offlineExecutors: 0 }
  );

  return {
    totalNodes: nodes.length,
    onlineNodes,
    offlineNodes: nodes.length - onlineNodes,
    ...totals,
    queuedCount: queueItems.length,
    stuckCount: queueItems.filter((item) => item.stuck).length,
    blockedCount: queueItems.filter((item) => item.blocked).length,
    buildableCount: queueItems.filter((item) => item.buildable).length,
    bottleneckCount: pools.filter((pool) => pool.severity !== "normal").length
  };
}

function buildOfflineImpact(
  nodes: NodeCapacityNodeViewModel[]
): NodeCapacityOfflineImpactViewModel[] {
  return nodes
    .filter((node) => node.isOffline && node.offlineExecutors > 0)
    .map((node) => ({
      nodeName: node.displayName,
      nodeUrl: node.nodeUrl,
      executors: node.offlineExecutors,
      reason: node.offlineReason
    }));
}

function buildExecutorGroup(
  executors: JenkinsNodeExecutor[] | undefined,
  labelPrefix: string
): NodeCapacityExecutorViewModel[] {
  if (!Array.isArray(executors)) {
    return [];
  }
  return executors.map((executor, index) => {
    const work = executor.currentExecutable ?? executor.currentWorkUnit;
    const isIdle = !work && executor.idle !== false;
    return {
      id:
        typeof executor.number === "number" ? `#${executor.number}` : `${labelPrefix} ${index + 1}`,
      statusLabel: isIdle ? "Idle" : "Busy",
      isIdle,
      workLabel:
        firstNonEmpty(work?.fullDisplayName, work?.displayName) ??
        (typeof work?.number === "number" ? `#${work.number}` : undefined) ??
        firstNonEmpty(work?.url),
      workUrl: firstNonEmpty(work?.url)
    };
  });
}

function buildHiddenLabelKeySet(nodes: JenkinsNodeInfo[]): Set<string> {
  const keys = new Set<string>();
  for (const node of nodes) {
    for (const label of classifyNodeLabels(node).hiddenLabels) {
      keys.add(normalizeLabelKey(label));
    }
  }
  return keys;
}

export function collectPoolLabels(
  nodes: JenkinsNodeInfo[],
  queueItems: QueueWorkItemViewModel[],
  hiddenLabelKeys: Set<string>
): string[] {
  const labelsByKey = new Map<string, string>();
  for (const node of nodes) {
    for (const label of classifyNodeLabels(node).poolLabels) {
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

export function buildNodeViewModelsByLabel(
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

export function groupQueueItemsByLabel(
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

export function resolvePoolSeverity(
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

export function comparePools(
  left: NodeCapacityPoolViewModel,
  right: NodeCapacityPoolViewModel
): number {
  const scoreDelta = scorePool(right) - scorePool(left);
  if (scoreDelta !== 0) {
    return scoreDelta;
  }
  if (left.kind !== right.kind) {
    return left.kind === "any" ? -1 : 1;
  }
  return left.label.localeCompare(right.label);
}

export function scorePool(pool: NodeCapacityPoolViewModel): number {
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

export function formatPoolStatus(
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

export function formatNodeStatus(node: JenkinsNodeInfo): string {
  if (node.offline === true) {
    return node.temporarilyOffline ? "Temporarily offline" : "Offline";
  }
  return "Online";
}

export function formatOfflineReason(node: JenkinsNodeInfo): string | undefined {
  return firstNonEmpty(
    node.offlineCauseReason,
    node.offlineCause?.description,
    node.offlineCause?.shortDescription
  );
}

function sumBy<T>(items: T[], getValue: (item: T) => number): number {
  return items.reduce((sum, item) => sum + getValue(item), 0);
}

function toNonNegativeInteger(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function resolveBusyExecutors(node: JenkinsNodeInfo, totalExecutors: number): number {
  if (node.offline === true) {
    return 0;
  }
  if (typeof node.busyExecutors === "number" && Number.isFinite(node.busyExecutors)) {
    return Math.min(totalExecutors, toNonNegativeInteger(node.busyExecutors));
  }
  if (!Array.isArray(node.executors)) {
    return 0;
  }
  return Math.min(
    totalExecutors,
    node.executors.filter(
      (executor) =>
        executor.currentExecutable !== undefined ||
        executor.currentWorkUnit !== undefined ||
        executor.idle === false
    ).length
  );
}
