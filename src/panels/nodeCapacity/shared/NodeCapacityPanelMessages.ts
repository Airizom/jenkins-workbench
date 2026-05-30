import type {
  NodeCapacityNodeExecutorsUpdateMessage,
  NodeCapacityUpdateMessage
} from "../../../shared/nodeCapacity/NodeCapacityContracts";
import {
  hasMessageType,
  isOpenExternalMessage,
  isRecord,
  parseSetLoadingOutgoingMessage
} from "../../../shared/runtimeGuards";
import type { OpenExternalMessage } from "../../../shared/runtimeGuards";

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
      return message as unknown as NodeCapacityUpdateMessage;
    case "updateNodeCapacityNodeExecutors":
      return message as unknown as NodeCapacityNodeExecutorsUpdateMessage;
    case "setLoading":
      return parseSetLoadingOutgoingMessage(message);
    default:
      return undefined;
  }
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
    typeof (message as { nodeUrl?: unknown }).nodeUrl === "string"
  );
}

export function isLoadNodeCapacityExecutorsMessage(
  message: unknown
): message is LoadNodeCapacityExecutorsMessage {
  if (!hasMessageType(message, "loadNodeCapacityExecutors")) {
    return false;
  }
  const nodeUrls = message.nodeUrls;
  return Array.isArray(nodeUrls) && nodeUrls.every((nodeUrl) => typeof nodeUrl === "string");
}
