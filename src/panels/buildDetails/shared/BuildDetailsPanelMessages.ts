// Public entry point for the Build Details panel message contract.
// Outgoing (extension -> webview) messages live in BuildDetailsOutgoingMessages.ts,
// incoming (webview -> extension) messages and guards in BuildDetailsIncomingMessages.ts.

export type {
  ApproveInputMessage,
  ArtifactActionMessage,
  BuildDetailsIncomingMessage,
  BuildManagementMessage,
  DownloadAllArtifactsMessage,
  OpenDiagnosticSourceMessage,
  OpenTestSourceMessage,
  PersistUiStateMessage,
  RejectInputMessage,
  ReloadTestReportMessage,
  RestartPipelineFromStageMessage,
  SelectPipelineLogNodeMessage
} from "./BuildDetailsIncomingMessages";
export {
  isApproveInputMessage,
  isArtifactActionMessage,
  isBuildDetailsReadyMessage,
  isClearPipelineLogNodeMessage,
  isConfigureBuildDiagnosticsMessage,
  isDeleteBuildMessage,
  isDownloadAllArtifactsMessage,
  isEditBuildMessage,
  isExportConsoleMessage,
  isExportPipelineNodeLogMessage,
  isNavigateBuildMessage,
  isOpenDiagnosticSourceMessage,
  isOpenExternalMessage,
  isOpenRelatedBuildMessage,
  isOpenTestSourceMessage,
  isPersistUiStateMessage,
  isRefreshBuildDetailsMessage,
  isRefreshRelatedBuildsMessage,
  isRejectInputMessage,
  isReloadTestReportMessage,
  isRestartPipelineFromStageMessage,
  isSelectPipelineLogNodeMessage,
  isSetKeepForeverMessage,
  isSetRelatedBuildsExpandedMessage,
  isShowBuildDiagnosticProblemsMessage,
  isToggleFollowLogMessage
} from "./BuildDetailsIncomingMessages";
export type {
  BuildDetailsOutgoingMessage,
  BuildDetailsStateMessage
} from "./BuildDetailsOutgoingMessages";
export { parseBuildDetailsOutgoingMessage } from "./BuildDetailsOutgoingMessages";
