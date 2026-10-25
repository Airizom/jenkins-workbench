// Public entry point for the Build Details panel message contract.
// Outgoing (extension -> webview) messages live in BuildDetailsOutgoingMessages.ts,
// incoming (webview -> extension) messages and guards in BuildDetailsIncomingMessages.ts.

export type {
  ApproveInputMessage,
  ArtifactActionMessage,
  BuildDetailsIncomingMessage,
  BuildManagementMessage,
  DeleteBuildMessage,
  EditBuildMessage,
  OpenDiagnosticSourceMessage,
  OpenTestSourceMessage,
  PersistUiStateMessage,
  RejectInputMessage,
  ReloadTestReportMessage,
  RestartPipelineFromStageMessage,
  SelectPipelineLogNodeMessage,
  SetKeepForeverMessage
} from "./BuildDetailsIncomingMessages";
export {
  isApproveInputMessage,
  isArtifactActionMessage,
  isClearPipelineLogNodeMessage,
  isConfigureBuildDiagnosticsMessage,
  isDeleteBuildMessage,
  isEditBuildMessage,
  isExportConsoleMessage,
  isExportPipelineNodeLogMessage,
  isOpenDiagnosticSourceMessage,
  isOpenExternalMessage,
  isOpenTestSourceMessage,
  isPersistUiStateMessage,
  isRefreshBuildDetailsMessage,
  isRejectInputMessage,
  isReloadTestReportMessage,
  isRestartPipelineFromStageMessage,
  isSelectPipelineLogNodeMessage,
  isSetKeepForeverMessage,
  isShowBuildDiagnosticProblemsMessage,
  isToggleFollowLogMessage
} from "./BuildDetailsIncomingMessages";
export type {
  BuildDetailsOutgoingMessage,
  BuildDetailsStateMessage
} from "./BuildDetailsOutgoingMessages";
export { parseBuildDetailsOutgoingMessage } from "./BuildDetailsOutgoingMessages";
