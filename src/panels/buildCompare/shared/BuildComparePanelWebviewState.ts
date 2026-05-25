import type { JenkinsEnvironmentRef } from "../../../jenkins/JenkinsEnvironmentRef";
import type { SerializedEnvironmentState } from "../../shared/webview/WebviewPanelState";
import {
  createEnvironmentScopedPanelState,
  isNonEmptyString,
  validateEnvironmentScopedPanelState
} from "../../shared/webview/WebviewPanelState";

export interface BuildComparePanelSerializedState extends SerializedEnvironmentState {
  baselineBuildUrl: string;
  targetBuildUrl: string;
}

export function createBuildComparePanelState(
  environment: JenkinsEnvironmentRef,
  baselineBuildUrl: string,
  targetBuildUrl: string
): BuildComparePanelSerializedState {
  return createEnvironmentScopedPanelState(environment, {
    baselineBuildUrl,
    targetBuildUrl
  });
}

export function isBuildComparePanelState(
  value: unknown
): value is BuildComparePanelSerializedState {
  return validateEnvironmentScopedPanelState(
    value,
    (record) => isNonEmptyString(record.baselineBuildUrl) && isNonEmptyString(record.targetBuildUrl)
  );
}

export function updateBuildComparePanelState(
  state: BuildComparePanelSerializedState,
  baselineBuildUrl: string,
  targetBuildUrl: string
): BuildComparePanelSerializedState {
  return {
    ...state,
    baselineBuildUrl,
    targetBuildUrl
  };
}
