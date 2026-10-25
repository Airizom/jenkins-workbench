import {
  isBringNodeOnlineMessage,
  isCopyNodeJsonMessage,
  isLaunchNodeAgentMessage,
  isLoadAdvancedNodeDetailsMessage,
  isOpenExternalMessage,
  isRefreshNodeDetailsMessage,
  isTakeNodeOfflineMessage
} from "./shared/NodeDetailsPanelMessages";

interface NodeDetailsMessageHandlers {
  refresh(): Promise<void>;
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
  if (isRefreshNodeDetailsMessage(message)) {
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
