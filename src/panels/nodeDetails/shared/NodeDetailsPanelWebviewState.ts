import type { JenkinsEnvironmentRef } from "../../../jenkins/JenkinsEnvironmentRef";
import type { SerializedEnvironmentState } from "../../shared/webview/WebviewPanelState";
import {
  createEnvironmentScopedPanelState,
  isNonEmptyString,
  validateEnvironmentScopedPanelState
} from "../../shared/webview/WebviewPanelState";

import { isNodeDetailsTab, type NodeDetailsTab } from "./NodeDetailsTabs";

export interface NodeDetailsPanelSerializedState extends SerializedEnvironmentState {
  nodeUrl: string;
  activeTab?: NodeDetailsTab;
  logFollowing?: boolean;
}

export function createNodeDetailsPanelState(
  environment: JenkinsEnvironmentRef,
  nodeUrl: string,
  preferences?: { activeTab?: NodeDetailsTab; logFollowing?: boolean }
): NodeDetailsPanelSerializedState {
  return createEnvironmentScopedPanelState(environment, { nodeUrl, ...preferences });
}

export function isNodeDetailsPanelState(value: unknown): value is NodeDetailsPanelSerializedState {
  return validateEnvironmentScopedPanelState(
    value,
    (record) =>
      isNonEmptyString(record.nodeUrl) &&
      (record.activeTab === undefined ||
        (typeof record.activeTab === "string" && isNodeDetailsTab(record.activeTab))) &&
      (record.logFollowing === undefined || typeof record.logFollowing === "boolean")
  );
}
