import type {
  NodeCapacityNodeExecutorsUpdateMessage,
  NodeCapacityUpdateMessage
} from "../../../shared/nodeCapacity/NodeCapacityContracts";
import type { OpenExternalMessage } from "../../../shared/runtimeGuards";
import {
  hasMessageType,
  isOpenExternalMessage,
  isRecord,
  parseSetLoadingOutgoingMessage
} from "../../../shared/runtimeGuards";

export type {
  NodeCapacityNodeExecutorsUpdateMessage,
  NodeCapacityUpdateMessage
} from "../../../shared/nodeCapacity/NodeCapacityContracts";

export interface RefreshNodeCapacityMessage {
  type: "refreshNodeCapacity";
}

export type { OpenExternalMessage };

export interface OpenNodeDetailsMessage {
  type: "openNodeDetails";
  nodeUrl: string;
  label?: string;
}

export interface LoadNodeCapacityExecutorsMessage {
  type: "loadNodeCapacityExecutors";
  /** Webview-assigned id echoed in the response so superseded responses can be ignored. */
  requestId: number;
  nodeUrls: string[];
}

export interface SetLoadingMessage {
  type: "setLoading";
  value: boolean;
}

export type NodeCapacityOutgoingMessage =
  | NodeCapacityUpdateMessage
  | NodeCapacityNodeExecutorsUpdateMessage
  | SetLoadingMessage;

export type NodeCapacityIncomingMessage =
  | RefreshNodeCapacityMessage
  | OpenExternalMessage
  | OpenNodeDetailsMessage
  | LoadNodeCapacityExecutorsMessage;

export function parseNodeCapacityOutgoingMessage(
  message: unknown
): NodeCapacityOutgoingMessage | undefined {
  if (!isRecord(message)) {
    return undefined;
  }
  switch (message.type) {
    case "updateNodeCapacity":
      return isNodeCapacityViewModelShape(message.payload)
        ? (message as unknown as NodeCapacityUpdateMessage)
        : undefined;
    case "updateNodeCapacityNodeExecutors":
      return typeof message.requestId === "number" &&
        Array.isArray(message.payload) &&
        message.payload.every(isNodeExecutorsResultShape)
        ? (message as unknown as NodeCapacityNodeExecutorsUpdateMessage)
        : undefined;
    case "setLoading":
      return parseSetLoadingOutgoingMessage(message);
    default:
      return undefined;
  }
}

function isNodeCapacityViewModelShape(value: unknown): boolean {
  return (
    isRecord(value) &&
    isRecord(value.summary) &&
    Array.isArray(value.pools) &&
    Array.isArray(value.hiddenLabelQueueItems) &&
    Array.isArray(value.errors)
  );
}

function isNodeExecutorsResultShape(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.nodeUrl === "string" &&
    (Array.isArray(value.executors) || typeof value.error === "string")
  );
}

export function isRefreshNodeCapacityMessage(
  message: unknown
): message is RefreshNodeCapacityMessage {
  return hasMessageType(message, "refreshNodeCapacity");
}

export { isOpenExternalMessage };

export function isOpenNodeDetailsMessage(message: unknown): message is OpenNodeDetailsMessage {
  return (
    hasMessageType(message, "openNodeDetails") &&
    typeof message.nodeUrl === "string" &&
    (message.label === undefined || typeof message.label === "string")
  );
}

export function isLoadNodeCapacityExecutorsMessage(
  message: unknown
): message is LoadNodeCapacityExecutorsMessage {
  if (!hasMessageType(message, "loadNodeCapacityExecutors")) {
    return false;
  }
  const nodeUrls = message.nodeUrls;
  return (
    typeof message.requestId === "number" &&
    Number.isSafeInteger(message.requestId) &&
    message.requestId >= 0 &&
    Array.isArray(nodeUrls) &&
    nodeUrls.every((nodeUrl) => typeof nodeUrl === "string")
  );
}
