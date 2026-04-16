import type { JenkinsEnvironmentRef } from "../../../jenkins/JenkinsEnvironmentRef";
import type { SerializedEnvironmentState } from "../../shared/webview/WebviewPanelState";
import { isSerializedEnvironmentState } from "../../shared/webview/WebviewPanelState";

export interface BuildComparePanelSerializedState extends SerializedEnvironmentState {
  baselineBuildUrl: string;
  targetBuildUrl: string;
}

export function createBuildComparePanelState(
  environment: JenkinsEnvironmentRef,
  baselineBuildUrl: string,
  targetBuildUrl: string
): BuildComparePanelSerializedState {
  return {
    environmentId: environment.environmentId,
    scope: environment.scope,
    baselineBuildUrl,
    targetBuildUrl
  };
}

export function isBuildComparePanelState(
  value: unknown
): value is BuildComparePanelSerializedState {
  if (!isSerializedEnvironmentState(value)) {
    return false;
  }
  const record = value as unknown as Record<string, unknown>;
  return (
    typeof record.baselineBuildUrl === "string" &&
    record.baselineBuildUrl.length > 0 &&
    typeof record.targetBuildUrl === "string" &&
    record.targetBuildUrl.length > 0
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
