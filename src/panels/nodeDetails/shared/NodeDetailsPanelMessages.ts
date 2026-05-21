import {
  asRecord,
  hasMessageType,
  isOpenExternalMessage,
  parseSetLoadingOutgoingMessage
} from "../../../shared/runtimeGuards";
import type { OpenExternalMessage } from "../../../shared/runtimeGuards";
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
