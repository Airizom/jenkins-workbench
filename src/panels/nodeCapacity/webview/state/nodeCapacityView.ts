import type {
  NodeCapacityCounts,
  NodeCapacityNodeViewModel,
  NodeCapacityPoolViewModel
} from "../../../../shared/nodeCapacity/NodeCapacityContracts";
import type { QueueWorkItemViewModel } from "../../../../shared/queueWork/QueueWorkContracts";

export type CapacityTone = "warning" | "failure";

/**
 * Text classes for tone-colored counts. Always the `-foreground` mix, which is
 * the design system's readable-text variant; the raw status colors are for
 * fills, dots, and icons.
 */
export const CAPACITY_TONE_TEXT_CLASSES: Record<CapacityTone, string> = {
  warning: "text-warning-foreground",
  failure: "text-failure-foreground"
};

type QueueToneCounts = Pick<NodeCapacityCounts, "queuedCount" | "stuckCount" | "idleExecutors">;

function isStarved(counts: QueueToneCounts): boolean {
  return counts.queuedCount > 0 && counts.idleExecutors === 0;
}

/**
 * Shared by the summary and every pool so a queued count means the same thing
 * everywhere. Mirrors the host's pool severity: stuck or starved work is
 * critical, any other queued work is pressure.
 */
export function resolveQueuedTone(counts: QueueToneCounts): CapacityTone | undefined {
  if (counts.stuckCount > 0 || isStarved(counts)) {
    return "failure";
  }
  return counts.queuedCount > 0 ? "warning" : undefined;
}

export function resolveIdleTone(counts: QueueToneCounts): CapacityTone | undefined {
  return isStarved(counts) ? "failure" : undefined;
}

export function resolveOfflineTone(offlineExecutors: number): CapacityTone | undefined {
  return offlineExecutors > 0 ? "warning" : undefined;
}

/** Rows shown before "Show all"; the "Any node" pool lists every agent. */
export const NODE_LIST_PREVIEW_LIMIT = 10;
/** Avoid a "Show 1 more" button: lists this close to the limit render whole. */
const NODE_LIST_PREVIEW_SLACK = 2;

function nodeOrderRank(node: NodeCapacityNodeViewModel): number {
  if (!node.isOffline) {
    return 2;
  }
  return node.isTemporarilyOffline ? 1 : 0;
}

/**
 * Disconnected nodes first, then temporarily offline ones, otherwise Jenkins
 * order, so a capped list never hides a fault. Ranks only change when a node's
 * connectivity does, so polling does not reshuffle rows.
 */
export function orderPoolNodes(
  nodes: readonly NodeCapacityNodeViewModel[]
): NodeCapacityNodeViewModel[] {
  return nodes
    .map((node, index) => ({ node, index, rank: nodeOrderRank(node) }))
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .map((entry) => entry.node);
}

export function isNodeListCapped(nodeCount: number, showAll: boolean): boolean {
  return !showAll && nodeCount > NODE_LIST_PREVIEW_LIMIT + NODE_LIST_PREVIEW_SLACK;
}

/**
 * The rows a pool renders. Executor loading uses the same list, so hidden rows
 * never cost a Jenkins request.
 */
export function getVisiblePoolNodes(
  orderedNodes: readonly NodeCapacityNodeViewModel[],
  showAll: boolean
): readonly NodeCapacityNodeViewModel[] {
  return isNodeListCapped(orderedNodes.length, showAll)
    ? orderedNodes.slice(0, NODE_LIST_PREVIEW_LIMIT)
    : orderedNodes;
}

export interface PoolFilter {
  query: string;
  attentionOnly: boolean;
}

export const EMPTY_POOL_FILTER: PoolFilter = { query: "", attentionOnly: false };

export function isPoolFilterActive(filter: PoolFilter): boolean {
  return filter.attentionOnly || normalizeQuery(filter.query).length > 0;
}

function normalizeQuery(query: string): string {
  return query.trim().toLocaleLowerCase();
}

function includesQuery(value: string, query: string): boolean {
  return value.toLocaleLowerCase().includes(query);
}

export function poolNeedsAttention(pool: Pick<NodeCapacityPoolViewModel, "severity">): boolean {
  return pool.severity !== "normal";
}

/** Matches the pool label, any node in it, or any job queued on it. */
function nodeMatchesQuery(node: NodeCapacityNodeViewModel, query: string): boolean {
  return includesQuery(node.displayName, query) || includesQuery(node.name, query);
}

/**
 * The nodes a pool lists under the filter. A pool that matched by its label
 * (or by a queued job only) lists every node; one that matched by node name
 * lists just the matching nodes, so a 28-node pool does not bury the one you
 * searched for.
 */
export function filterPoolNodes(
  pool: Pick<NodeCapacityPoolViewModel, "label" | "nodes">,
  query: string
): readonly NodeCapacityNodeViewModel[] {
  const normalized = normalizeQuery(query);
  if (!normalized || includesQuery(pool.label, normalized)) {
    return pool.nodes;
  }
  const matches = pool.nodes.filter((node) => nodeMatchesQuery(node, normalized));
  return matches.length > 0 ? matches : pool.nodes;
}

function poolMatchesQuery(pool: NodeCapacityPoolViewModel, query: string): boolean {
  return (
    includesQuery(pool.label, query) ||
    pool.nodes.some((node) => nodeMatchesQuery(node, query)) ||
    pool.queueItems.some((item) => includesQuery(item.name, query))
  );
}

export function filterPools(
  pools: readonly NodeCapacityPoolViewModel[],
  filter: PoolFilter
): readonly NodeCapacityPoolViewModel[] {
  const query = normalizeQuery(filter.query);
  if (!query && !filter.attentionOnly) {
    return pools;
  }
  return pools.filter(
    (pool) =>
      (!filter.attentionOnly || poolNeedsAttention(pool)) &&
      (!query || poolMatchesQuery(pool, query))
  );
}

export interface PinnedNode {
  nodeUrl?: string;
  displayName: string;
}

/**
 * Jenkins gives every agent a label equal to its own name. The host keeps
 * those "self" labels out of the pool list; this maps them back to the node so
 * pinned queue items can link to it.
 */
export function buildPinnedNodeIndex(
  pools: readonly NodeCapacityPoolViewModel[]
): ReadonlyMap<string, PinnedNode> {
  const index = new Map<string, PinnedNode>();
  for (const pool of pools) {
    for (const node of pool.nodes) {
      for (const label of node.hiddenLabels) {
        if (!index.has(label)) {
          index.set(label, { nodeUrl: node.nodeUrl, displayName: node.displayName });
        }
      }
    }
  }
  return index;
}

/** The single node an item is pinned to, when its request is exactly one self label. */
export function resolvePinnedNode(
  item: Pick<QueueWorkItemViewModel, "queuedForLabels">,
  pinnedNodes: ReadonlyMap<string, PinnedNode>
): PinnedNode | undefined {
  if (item.queuedForLabels.length !== 1) {
    return undefined;
  }
  return pinnedNodes.get(item.queuedForLabels[0]);
}

export function filterPinnedQueueItems(
  items: readonly QueueWorkItemViewModel[],
  filter: PoolFilter
): readonly QueueWorkItemViewModel[] {
  const query = normalizeQuery(filter.query);
  if (!query && !filter.attentionOnly) {
    return items;
  }
  return items.filter(
    (item) =>
      (!filter.attentionOnly || item.stuck) &&
      (!query ||
        includesQuery(item.name, query) ||
        item.queuedForLabels.some((label) => includesQuery(label, query)))
  );
}
