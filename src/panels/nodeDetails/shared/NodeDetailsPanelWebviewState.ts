import type { JenkinsEnvironmentRef } from "../../../jenkins/JenkinsEnvironmentRef";
import type { SerializedEnvironmentState } from "../../shared/webview/WebviewPanelState";
import {
  createEnvironmentScopedPanelState,
  isNonEmptyString,
  validateEnvironmentScopedPanelState
} from "../../shared/webview/WebviewPanelState";

export interface NodeDetailsPanelSerializedState extends SerializedEnvironmentState {
  nodeUrl: string;
}

export function createNodeDetailsPanelState(
  environment: JenkinsEnvironmentRef,
  nodeUrl: string
): NodeDetailsPanelSerializedState {
  return createEnvironmentScopedPanelState(environment, { nodeUrl });
}

export function isNodeDetailsPanelState(value: unknown): value is NodeDetailsPanelSerializedState {
  return validateEnvironmentScopedPanelState(value, (record) => isNonEmptyString(record.nodeUrl));
}
