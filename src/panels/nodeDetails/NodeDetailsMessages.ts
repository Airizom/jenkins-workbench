import type { NodeDetailsUpdateMessage } from "./shared/NodeDetailsContracts";

export type { NodeDetailsUpdateMessage } from "./shared/NodeDetailsContracts";

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

export function isRefreshNodeDetailsMessage(
  message: unknown
): message is RefreshNodeDetailsMessage {
  return asRecord(message)?.type === "refreshNodeDetails";
}

export function isLoadAdvancedNodeDetailsMessage(
  message: unknown
): message is LoadAdvancedNodeDetailsMessage {
  return asRecord(message)?.type === "loadAdvancedNodeDetails";
}

export function isOpenExternalMessage(message: unknown): message is OpenExternalMessage {
  const record = asRecord(message);
  return record?.type === "openExternal" && typeof record.url === "string";
}

export function isTakeNodeOfflineMessage(message: unknown): message is TakeNodeOfflineMessage {
  return asRecord(message)?.type === "takeNodeOffline";
}

export function isBringNodeOnlineMessage(message: unknown): message is BringNodeOnlineMessage {
  return asRecord(message)?.type === "bringNodeOnline";
}

export function isLaunchNodeAgentMessage(message: unknown): message is LaunchNodeAgentMessage {
  return asRecord(message)?.type === "launchNodeAgent";
}

export function isCopyNodeJsonMessage(message: unknown): message is CopyNodeJsonMessage {
  const record = asRecord(message);
  return record?.type === "copyNodeJson" && typeof record.content === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}
