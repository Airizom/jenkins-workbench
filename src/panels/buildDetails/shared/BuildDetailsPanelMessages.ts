// Public entry point for the Build Details panel message contract.
// Outgoing (extension -> webview) messages live in BuildDetailsOutgoingMessages.ts,
// incoming (webview -> extension) messages and guards in BuildDetailsIncomingMessages.ts.

export type {
  ApproveInputMessage,
  ArtifactActionMessage,
  BuildDetailsIncomingMessage,
  ClearPipelineLogNodeMessage,
  ConfigureBuildDiagnosticsMessage,
  ExportConsoleMessage,
  ExportPipelineNodeLogMessage,
  OpenDiagnosticSourceMessage,
  OpenExternalMessage,
  OpenTestSourceMessage,
  PersistUiStateMessage,
  RefreshBuildDetailsMessage,
  RejectInputMessage,
  ReloadTestReportMessage,
  RestartPipelineFromStageMessage,
  SelectPipelineLogNodeMessage,
  ShowBuildDiagnosticProblemsMessage,
  ToggleFollowLogMessage
} from "./BuildDetailsIncomingMessages";
export {
  isApproveInputMessage,
  isArtifactActionMessage,
  isClearPipelineLogNodeMessage,
  isConfigureBuildDiagnosticsMessage,
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
  isShowBuildDiagnosticProblemsMessage,
  isToggleFollowLogMessage
} from "./BuildDetailsIncomingMessages";
export type {
  BuildDetailsOutgoingMessage,
  BuildDetailsStateMessage,
  BuildDetailsUpdateMessage
} from "./BuildDetailsOutgoingMessages";
export { parseBuildDetailsOutgoingMessage } from "./BuildDetailsOutgoingMessages";
