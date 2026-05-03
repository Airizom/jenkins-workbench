import type {
  NodeCapacityNodeExecutorsUpdateMessage,
  NodeCapacityUpdateMessage
} from "../../../shared/nodeCapacity/NodeCapacityContracts";

export type {
  NodeCapacityNodeExecutorsUpdateMessage,
  NodeCapacityUpdateMessage
} from "../../../shared/nodeCapacity/NodeCapacityContracts";

export interface RefreshNodeCapacityMessage {
  type: "refreshNodeCapacity";
}

export interface OpenExternalMessage {
  type: "openExternal";
  url: string;
}

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
      return typeof message.value === "boolean"
        ? (message as unknown as SetLoadingMessage)
        : undefined;
    default:
      return undefined;
  }
}

export function isRefreshNodeCapacityMessage(
  message: unknown
): message is RefreshNodeCapacityMessage {
  return hasMessageType(message, "refreshNodeCapacity");
}

export function isOpenExternalMessage(message: unknown): message is OpenExternalMessage {
  return (
    hasMessageType(message, "openExternal") &&
    typeof (message as { url?: unknown }).url === "string"
  );
}

export function isOpenNodeDetailsMessage(message: unknown): message is OpenNodeDetailsMessage {
  return (
    hasMessageType(message, "openNodeDetails") &&
    typeof (message as { nodeUrl?: unknown }).nodeUrl === "string"
  );
}

export function isLoadNodeCapacityExecutorsMessage(
  message: unknown
): message is LoadNodeCapacityExecutorsMessage {
  const nodeUrls = (message as { nodeUrls?: unknown }).nodeUrls;
  return (
    hasMessageType(message, "loadNodeCapacityExecutors") &&
    Array.isArray(nodeUrls) &&
    nodeUrls.every((nodeUrl) => typeof nodeUrl === "string")
  );
}

function hasMessageType(message: unknown, type: string): boolean {
  return isRecord(message) && message.type === type;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
