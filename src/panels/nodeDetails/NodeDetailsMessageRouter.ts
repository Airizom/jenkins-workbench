import { hasMessageType } from "../../shared/runtimeGuards";
import {
  isBringNodeOnlineMessage,
  isCopyNodeJsonMessage,
  isLaunchNodeAgentMessage,
  isLoadAdvancedNodeDetailsMessage,
  isNodeManagementMessage,
  isOpenExternalMessage,
  isRefreshNodeDetailsMessage,
  isSetNodeAgentLogFollowingMessage,
  isSetNodeDetailsTabMessage,
  isTakeNodeOfflineMessage,
  type NodeManagementAction
} from "./shared/NodeDetailsPanelMessages";
import type { NodeDetailsTab } from "./shared/NodeDetailsTabs";

interface NodeDetailsMessageHandlers {
  refresh(): Promise<void>;
  manageNode?(action: NodeManagementAction): Promise<void>;
  selectTab?(tab: NodeDetailsTab): void;
  setLogFollowing?(following: boolean): void;
  refreshLog?(): void;
  copyLog?(): Promise<void>;
  loadAdvanced(): Promise<void>;
  performAction(action: "takeNodeOffline" | "bringNodeOnline" | "launchNodeAgent"): Promise<void>;
  openExternal(url: string): Promise<void>;
  copyJson(content: string): Promise<void>;
}

/** Validate webview input before dispatching to panel operations. */
export function routeNodeDetailsMessage(
  message: unknown,
  handlers: NodeDetailsMessageHandlers
): void {
  if (isNodeManagementMessage(message)) {
    void handlers.manageNode?.(message.type);
  } else if (isSetNodeDetailsTabMessage(message)) {
    handlers.selectTab?.(message.tab);
  } else if (isSetNodeAgentLogFollowingMessage(message)) {
    handlers.setLogFollowing?.(message.following);
  } else if (hasMessageType(message, "refreshNodeAgentLog")) {
    handlers.refreshLog?.();
  } else if (hasMessageType(message, "copyNodeAgentLog")) {
    void handlers.copyLog?.();
  } else if (isRefreshNodeDetailsMessage(message)) {
    void handlers.refresh();
  } else if (isLoadAdvancedNodeDetailsMessage(message)) {
    void handlers.loadAdvanced();
  } else if (isTakeNodeOfflineMessage(message)) {
    void handlers.performAction("takeNodeOffline");
  } else if (isBringNodeOnlineMessage(message)) {
    void handlers.performAction("bringNodeOnline");
  } else if (isLaunchNodeAgentMessage(message)) {
    void handlers.performAction("launchNodeAgent");
  } else if (isOpenExternalMessage(message)) {
    void handlers.openExternal(message.url);
  } else if (isCopyNodeJsonMessage(message)) {
    void handlers.copyJson(message.content);
  }
}
