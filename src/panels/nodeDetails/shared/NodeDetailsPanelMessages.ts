import type { NodeDetailsUpdateMessage } from "./NodeDetailsContracts";

export type { NodeDetailsUpdateMessage } from "./NodeDetailsContracts";

export type NodeDetailsOutgoingMessage =
  | NodeDetailsUpdateMessage
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

export interface OpenExternalMessage {
  type: "openExternal";
  url: string;
}

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

export function parseNodeDetailsOutgoingMessage(
  message: unknown
): NodeDetailsOutgoingMessage | undefined {
  const record = asRecord(message);
  if (!record) {
    return undefined;
  }

  switch (record.type) {
    case "setLoading": {
      return { type: "setLoading", value: Boolean(record.value) };
    }
    case "updateNodeDetails": {
      return record as unknown as NodeDetailsUpdateMessage;
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

export function isOpenExternalMessage(message: unknown): message is OpenExternalMessage {
  if (!hasMessageType(message, "openExternal")) {
    return false;
  }
  return typeof message.url === "string";
}

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function hasMessageType<TType extends string>(
  message: unknown,
  type: TType
): message is Record<string, unknown> & { type: TType } {
  return asRecord(message)?.type === type;
}
