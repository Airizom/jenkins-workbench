import { isFiniteNumber, toNonNegativeInteger } from "../shared/numbers";
import { firstNonEmpty } from "../shared/stringValues";
import { formatExecutorStatusLabel } from "./NodeExecutorFormatters";
import type { JenkinsNodeExecutor } from "./types";

export interface JenkinsNodeOfflineCauseFields {
  offlineCauseReason?: string;
  offlineCause?: {
    description?: string;
    shortDescription?: string;
  };
}

export interface NodeConnectivityFields {
  offline: boolean;
  temporarilyOffline: boolean;
}

export interface NodeExecutorCountFields {
  numExecutors?: number;
  busyExecutors?: number;
  offline?: boolean;
  executors?: JenkinsNodeExecutor[];
}

type NodeConnectivityState = "unknown" | "temporary-offline" | "offline" | "idle" | "online";

export type NodeStatusClass = "online" | "offline" | "idle" | "temporary" | "unknown";

export interface NodeStatusDescriptor {
  label: string;
  className: NodeStatusClass;
}

const NODE_STATUS_DESCRIPTORS = {
  unknown: { label: "Unknown", className: "unknown" },
  "temporary-offline": { label: "Temporarily offline", className: "temporary" },
  offline: { label: "Offline", className: "offline" },
  idle: { label: "Idle", className: "idle" },
  online: { label: "Online", className: "online" }
} as const satisfies Record<NodeConnectivityState, NodeStatusDescriptor>;

export function resolveNodeStatusDescriptor(
  node?: (NodeConnectivityFields & { idle?: boolean }) | null
): NodeStatusDescriptor {
  return NODE_STATUS_DESCRIPTORS[resolveNodeConnectivityState(node)];
}

export function formatNodeOfflineReason(node?: JenkinsNodeOfflineCauseFields): string | undefined {
  return firstNonEmpty(
    node?.offlineCauseReason,
    node?.offlineCause?.description,
    node?.offlineCause?.shortDescription
  );
}

function resolveNodeConnectivityState(
  node?: (NodeConnectivityFields & { idle?: boolean }) | null
): NodeConnectivityState {
  if (!node) {
    return "unknown";
  }
  if (node.offline === true) {
    return node.temporarilyOffline ? "temporary-offline" : "offline";
  }
  if (node.idle === true) {
    return "idle";
  }
  if (node.offline === false) {
    return "online";
  }
  return "unknown";
}

export function formatNodeStatusLabel(node: NodeConnectivityFields): string {
  return resolveNodeStatusDescriptor(node).label;
}

export function formatNodeTreeDescription(
  node: NodeConnectivityFields & NodeExecutorCountFields
): string {
  const state = resolveNodeConnectivityState(node);
  if (state === "temporary-offline" || state === "offline") {
    return resolveNodeStatusDescriptor(node).label;
  }

  const ratio = formatNodeBusyExecutorRatio(node, { suffix: " busy" });
  if (ratio) {
    return ratio;
  }

  return "Online";
}

export function formatNodeBusyExecutorRatio(
  node: NodeExecutorCountFields,
  options?: { prefix?: string; suffix?: string }
): string | undefined {
  const total = node.numExecutors;
  const busy = node.busyExecutors;
  if (isFiniteNumber(total) && isFiniteNumber(busy)) {
    return `${options?.prefix ?? ""}${busy}/${total}${options?.suffix ?? ""}`;
  }
  return undefined;
}

export function resolveBusyExecutors(
  node: NodeExecutorCountFields,
  totalExecutors: number
): number {
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

export function formatNodeIdleLabel(
  node?: { idle?: boolean } | null,
  unknownLabel = "Unknown"
): string {
  if (!node) {
    return unknownLabel;
  }
  if (node.idle === true) {
    return formatExecutorStatusLabel(true);
  }
  if (node.idle === false) {
    return formatExecutorStatusLabel(false);
  }
  return unknownLabel;
}
