import type { OpenExternalMessage } from "../../../shared/runtimeGuards";
import { hasMessageType, isOpenExternalMessage } from "../../../shared/runtimeGuards";
import type { ArtifactAction, PipelineLogTargetViewModel } from "./BuildDetailsContracts";
import { isPipelineLogTargetViewModel } from "./BuildDetailsContracts";
import {
  type BuildDetailsPanelUiState,
  isBuildDetailsPanelUiState,
  normalizeBuildDetailsPanelUiState
} from "./BuildDetailsPanelWebviewState";

export interface ToggleFollowLogMessage {
  type: "toggleFollowLog";
  value?: unknown;
}

export type { OpenExternalMessage };

export interface ExportConsoleMessage {
  type: "exportConsole";
}

export interface ArtifactActionMessage {
  type: "artifactAction";
  action: ArtifactAction;
  relativePath: string;
  fileName?: string;
}

export interface ApproveInputMessage {
  type: "approveInput";
  inputId: string;
}

export interface RejectInputMessage {
  type: "rejectInput";
  inputId: string;
}

export interface RestartPipelineFromStageMessage {
  type: "restartPipelineFromStage";
  stageName: string;
}

export interface SelectPipelineLogNodeMessage {
  type: "selectPipelineLogNode";
  target: PipelineLogTargetViewModel;
}

export interface ClearPipelineLogNodeMessage {
  type: "clearPipelineLogNode";
}

export interface ExportPipelineNodeLogMessage {
  type: "exportPipelineNodeLog";
}

export interface ReloadTestReportMessage {
  type: "reloadTestReport";
  includeCaseLogs?: boolean;
}

export interface OpenTestSourceMessage {
  type: "openTestSource";
  testName: string;
  className?: string;
  suiteName?: string;
}

export interface PersistUiStateMessage {
  type: "persistUiState";
  uiState: BuildDetailsPanelUiState;
}

export interface RefreshBuildDetailsMessage {
  type: "refreshBuildDetails";
}

export interface OpenDiagnosticSourceMessage {
  type: "openDiagnosticSource";
  targetId: string;
}

export interface ConfigureBuildDiagnosticsMessage {
  type: "configureBuildDiagnostics";
}

export interface ShowBuildDiagnosticProblemsMessage {
  type: "showBuildDiagnosticProblems";
}

export type BuildDetailsIncomingMessage =
  | RefreshBuildDetailsMessage
  | ToggleFollowLogMessage
  | OpenExternalMessage
  | ExportConsoleMessage
  | ArtifactActionMessage
  | ApproveInputMessage
  | RejectInputMessage
  | RestartPipelineFromStageMessage
  | SelectPipelineLogNodeMessage
  | ClearPipelineLogNodeMessage
  | ExportPipelineNodeLogMessage
  | ReloadTestReportMessage
  | OpenTestSourceMessage
  | OpenDiagnosticSourceMessage
  | ConfigureBuildDiagnosticsMessage
  | ShowBuildDiagnosticProblemsMessage
  | PersistUiStateMessage;

export function isToggleFollowLogMessage(message: unknown): message is ToggleFollowLogMessage {
  return hasMessageType(message, "toggleFollowLog");
}

export { isOpenExternalMessage };

export function isExportConsoleMessage(message: unknown): message is ExportConsoleMessage {
  return hasMessageType(message, "exportConsole");
}

export function isRefreshBuildDetailsMessage(
  message: unknown
): message is RefreshBuildDetailsMessage {
  return hasMessageType(message, "refreshBuildDetails");
}

export function isArtifactActionMessage(message: unknown): message is ArtifactActionMessage {
  if (!hasMessageType(message, "artifactAction")) {
    return false;
  }
  const { action, relativePath, fileName } = message;
  if (action !== "preview" && action !== "download") {
    return false;
  }
  if (typeof fileName !== "undefined" && typeof fileName !== "string") {
    return false;
  }
  return typeof relativePath === "string" && relativePath.length > 0;
}

export function isApproveInputMessage(message: unknown): message is ApproveInputMessage {
  if (!hasMessageType(message, "approveInput")) {
    return false;
  }
  const { inputId } = message;
  return typeof inputId === "string" && inputId.length > 0;
}

export function isRejectInputMessage(message: unknown): message is RejectInputMessage {
  if (!hasMessageType(message, "rejectInput")) {
    return false;
  }
  const { inputId } = message;
  return typeof inputId === "string" && inputId.length > 0;
}

export function isRestartPipelineFromStageMessage(
  message: unknown
): message is RestartPipelineFromStageMessage {
  if (!hasMessageType(message, "restartPipelineFromStage")) {
    return false;
  }
  const { stageName } = message;
  return typeof stageName === "string" && stageName.trim().length > 0;
}

export function isSelectPipelineLogNodeMessage(
  message: unknown
): message is SelectPipelineLogNodeMessage {
  if (!hasMessageType(message, "selectPipelineLogNode")) {
    return false;
  }
  return isPipelineLogTargetViewModel(message.target);
}

export function isClearPipelineLogNodeMessage(
  message: unknown
): message is ClearPipelineLogNodeMessage {
  return hasMessageType(message, "clearPipelineLogNode");
}

export function isExportPipelineNodeLogMessage(
  message: unknown
): message is ExportPipelineNodeLogMessage {
  return hasMessageType(message, "exportPipelineNodeLog");
}

export function isReloadTestReportMessage(message: unknown): message is ReloadTestReportMessage {
  if (!hasMessageType(message, "reloadTestReport")) {
    return false;
  }
  return (
    typeof message.includeCaseLogs === "undefined" || typeof message.includeCaseLogs === "boolean"
  );
}

export function isOpenTestSourceMessage(message: unknown): message is OpenTestSourceMessage {
  if (!hasMessageType(message, "openTestSource")) {
    return false;
  }
  const { testName, className, suiteName } = message;
  if (typeof testName !== "string" || testName.trim().length === 0) {
    return false;
  }
  if (typeof className !== "undefined" && typeof className !== "string") {
    return false;
  }
  if (typeof suiteName !== "undefined" && typeof suiteName !== "string") {
    return false;
  }
  return true;
}

export function isOpenDiagnosticSourceMessage(
  message: unknown
): message is OpenDiagnosticSourceMessage {
  if (!hasMessageType(message, "openDiagnosticSource")) {
    return false;
  }
  return typeof message.targetId === "string" && message.targetId.trim().length > 0;
}

export function isConfigureBuildDiagnosticsMessage(
  message: unknown
): message is ConfigureBuildDiagnosticsMessage {
  return hasMessageType(message, "configureBuildDiagnostics");
}

export function isShowBuildDiagnosticProblemsMessage(
  message: unknown
): message is ShowBuildDiagnosticProblemsMessage {
  return hasMessageType(message, "showBuildDiagnosticProblems");
}

export function isPersistUiStateMessage(message: unknown): message is PersistUiStateMessage {
  if (!hasMessageType(message, "persistUiState")) {
    return false;
  }
  return (
    isBuildDetailsPanelUiState(message.uiState) &&
    normalizeBuildDetailsPanelUiState(message.uiState) !== undefined
  );
}
