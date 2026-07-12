import type {
  ArtifactAction,
  BuildFailureArtifact,
  BuildTestCaseViewModel,
  PipelineLogTargetViewModel
} from "../shared/BuildDetailsContracts";
import type {
  ApproveInputMessage,
  ArtifactActionMessage,
  ClearPipelineLogNodeMessage,
  ExportConsoleMessage,
  ExportPipelineNodeLogMessage,
  OpenTestSourceMessage,
  RefreshBuildDetailsMessage,
  RejectInputMessage,
  ReloadTestReportMessage,
  RestartPipelineFromStageMessage,
  SelectPipelineLogNodeMessage,
  ToggleFollowLogMessage
} from "../shared/BuildDetailsPanelMessages";

export function buildToggleFollowLogMessage(value: boolean): ToggleFollowLogMessage {
  return { type: "toggleFollowLog", value };
}

export function buildRefreshBuildDetailsMessage(): RefreshBuildDetailsMessage {
  return { type: "refreshBuildDetails" };
}

export function buildExportConsoleMessage(): ExportConsoleMessage {
  return { type: "exportConsole" };
}

export function buildApproveInputMessage(inputId: string): ApproveInputMessage {
  return { type: "approveInput", inputId };
}

export function buildRejectInputMessage(inputId: string): RejectInputMessage {
  return { type: "rejectInput", inputId };
}

export function buildRestartPipelineFromStageMessage(
  stageName: string
): RestartPipelineFromStageMessage {
  return { type: "restartPipelineFromStage", stageName };
}

export function buildSelectPipelineLogNodeMessage(
  target: PipelineLogTargetViewModel
): SelectPipelineLogNodeMessage {
  return { type: "selectPipelineLogNode", target };
}

export function buildClearPipelineLogNodeMessage(): ClearPipelineLogNodeMessage {
  return { type: "clearPipelineLogNode" };
}

export function buildExportPipelineNodeLogMessage(): ExportPipelineNodeLogMessage {
  return { type: "exportPipelineNodeLog" };
}

export function buildArtifactActionMessage(
  action: ArtifactAction,
  artifact: BuildFailureArtifact
): ArtifactActionMessage {
  return {
    type: "artifactAction",
    action,
    relativePath: artifact.relativePath,
    fileName: artifact.fileName ?? undefined
  };
}

export function buildReloadTestReportMessage(): ReloadTestReportMessage {
  return {
    type: "reloadTestReport",
    includeCaseLogs: true
  };
}

export function buildOpenTestSourceMessage(
  testCase: BuildTestCaseViewModel
): OpenTestSourceMessage {
  return {
    type: "openTestSource",
    testName: testCase.name,
    className: testCase.className,
    suiteName: testCase.suiteName
  };
}
