import type { OpenExternalMessage } from "../../../shared/runtimeGuards";
import {
  asRecord,
  hasMessageType,
  isOpenExternalMessage,
  isPlainRecord,
  parseSetLoadingOutgoingMessage
} from "../../../shared/runtimeGuards";
import type { NodeDetailsViewModel, NodeStatusClass } from "./NodeDetailsContracts";

export interface NodeDetailsUpdateMessage {
  type: "updateNodeDetails";
  payload: NodeDetailsViewModel;
}

export interface NodeDetailsCopyJsonResultMessage {
  type: "copyNodeJsonResult";
  success: boolean;
}

export type NodeDetailsOutgoingMessage =
  | NodeDetailsUpdateMessage
  | NodeDetailsCopyJsonResultMessage
  | { type: "setLoading"; value: boolean };

export interface RefreshNodeDetailsMessage {
  type: "refreshNodeDetails";
}

export interface LoadAdvancedNodeDetailsMessage {
  type: "loadAdvancedNodeDetails";
}

export interface TakeNodeOfflineMessage {
  type: "takeNodeOffline";
}

export interface BringNodeOnlineMessage {
  type: "bringNodeOnline";
}

export interface LaunchNodeAgentMessage {
  type: "launchNodeAgent";
}

export type { OpenExternalMessage };

export interface CopyNodeJsonMessage {
  type: "copyNodeJson";
  content: string;
}

export type NodeDetailsIncomingMessage =
  | RefreshNodeDetailsMessage
  | LoadAdvancedNodeDetailsMessage
  | TakeNodeOfflineMessage
  | BringNodeOnlineMessage
  | LaunchNodeAgentMessage
  | OpenExternalMessage
  | CopyNodeJsonMessage;

const NODE_STATUS_CLASSES: ReadonlySet<string> = new Set<NodeStatusClass>([
  "online",
  "offline",
  "idle",
  "temporary",
  "unknown"
]);

const REQUIRED_STRING_FIELDS = [
  "environmentLabel",
  "displayName",
  "name",
  "updatedAt",
  "statusLabel",
  "activityLabel",
  "executorsLabel",
  "rawJson"
] as const;

const OPTIONAL_STRING_FIELDS = [
  "description",
  "url",
  "offlineReason",
  "jnlpAgentLabel",
  "launchSupportedLabel",
  "manualLaunchLabel"
] as const;

const REQUIRED_BOOLEAN_FIELDS = [
  "detailsAvailable",
  "refreshFailed",
  "isOffline",
  "isTemporarilyOffline",
  "canTakeOffline",
  "canBringOnline",
  "canLaunchAgent",
  "canOpenAgentInstructions",
  "advancedLoaded"
] as const;

const REQUIRED_ARRAY_FIELDS = [
  "executors",
  "oneOffExecutors",
  "monitorData",
  "loadStatistics"
] as const;

const QUEUED_WORK_ARRAY_FIELDS = [
  "matchingQueueItems",
  "anyQueueItems",
  "selfLabelQueueItems"
] as const;

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isRecordArray(value: unknown): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.every((entry) => isPlainRecord(entry));
}

function isNodeExecutorViewModel(value: unknown): boolean {
  return (
    isPlainRecord(value) &&
    typeof value.id === "string" &&
    typeof value.statusLabel === "string" &&
    typeof value.isIdle === "boolean"
  );
}

function isNodeMonitorViewModel(value: unknown): boolean {
  return isPlainRecord(value) && typeof value.key === "string" && typeof value.summary === "string";
}

export function isNodeDetailsViewModel(value: unknown): value is NodeDetailsViewModel {
  if (!isPlainRecord(value)) {
    return false;
  }
  if (!REQUIRED_STRING_FIELDS.every((field) => typeof value[field] === "string")) {
    return false;
  }
  if (
    !OPTIONAL_STRING_FIELDS.every(
      (field) => value[field] === undefined || typeof value[field] === "string"
    )
  ) {
    return false;
  }
  if (!REQUIRED_BOOLEAN_FIELDS.every((field) => typeof value[field] === "boolean")) {
    return false;
  }
  if (
    value.offlineSinceMs !== undefined &&
    (typeof value.offlineSinceMs !== "number" || !Number.isFinite(value.offlineSinceMs))
  ) {
    return false;
  }
  if (typeof value.statusClass !== "string" || !NODE_STATUS_CLASSES.has(value.statusClass)) {
    return false;
  }
  if (!isStringArray(value.labels) || !isStringArray(value.errors)) {
    return false;
  }
  if (!REQUIRED_ARRAY_FIELDS.every((field) => isRecordArray(value[field]))) {
    return false;
  }
  if (
    !(value.executors as unknown[]).every(isNodeExecutorViewModel) ||
    !(value.oneOffExecutors as unknown[]).every(isNodeExecutorViewModel)
  ) {
    return false;
  }
  if (
    !(value.monitorData as unknown[]).every(isNodeMonitorViewModel) ||
    !(value.loadStatistics as unknown[]).every(isNodeMonitorViewModel)
  ) {
    return false;
  }
  const queuedWork = value.queuedWork;
  if (!isPlainRecord(queuedWork)) {
    return false;
  }
  return QUEUED_WORK_ARRAY_FIELDS.every((field) => isRecordArray(queuedWork[field]));
}

export function parseNodeDetailsOutgoingMessage(
  message: unknown
): NodeDetailsOutgoingMessage | undefined {
  const record = asRecord(message);
  if (!record) {
    return undefined;
  }

  switch (record.type) {
    case "setLoading": {
      return parseSetLoadingOutgoingMessage(record);
    }
    case "updateNodeDetails": {
      const payload = record.payload;
      if (!isNodeDetailsViewModel(payload)) {
        return undefined;
      }
      return { type: "updateNodeDetails", payload };
    }
    case "copyNodeJsonResult": {
      if (typeof record.success !== "boolean") {
        return undefined;
      }
      return { type: "copyNodeJsonResult", success: record.success };
    }
    default:
      return undefined;
  }
}

export function isRefreshNodeDetailsMessage(
  message: unknown
): message is RefreshNodeDetailsMessage {
  return hasMessageType(message, "refreshNodeDetails");
}

export function isLoadAdvancedNodeDetailsMessage(
  message: unknown
): message is LoadAdvancedNodeDetailsMessage {
  return hasMessageType(message, "loadAdvancedNodeDetails");
}

export { isOpenExternalMessage };

export function isTakeNodeOfflineMessage(message: unknown): message is TakeNodeOfflineMessage {
  return hasMessageType(message, "takeNodeOffline");
}

export function isBringNodeOnlineMessage(message: unknown): message is BringNodeOnlineMessage {
  return hasMessageType(message, "bringNodeOnline");
}

export function isLaunchNodeAgentMessage(message: unknown): message is LaunchNodeAgentMessage {
  return hasMessageType(message, "launchNodeAgent");
}

export function isCopyNodeJsonMessage(message: unknown): message is CopyNodeJsonMessage {
  if (!hasMessageType(message, "copyNodeJson")) {
    return false;
  }
  return typeof message.content === "string";
}
