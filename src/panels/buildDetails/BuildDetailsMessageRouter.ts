import {
  type ApproveInputMessage,
  type ArtifactActionMessage,
  type BuildManagementMessage,
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
  isToggleFollowLogMessage,
  type OpenDiagnosticSourceMessage,
  type OpenTestSourceMessage,
  type PersistUiStateMessage,
  type RejectInputMessage,
  type ReloadTestReportMessage,
  type RestartPipelineFromStageMessage,
  type SelectPipelineLogNodeMessage
} from "./shared/BuildDetailsPanelMessages";

export interface BuildDetailsMessageRouterHandlers {
  onBuildDetailsReady?(): void;
  onSetRelatedBuildsExpanded?(expanded: boolean): void;
  onRefreshRelatedBuilds?(): void;
  onOpenRelatedBuild?(targetId: string): void;
  onNavigateBuild?(direction: "back" | "forward"): void;
  onArtifactAction(message: ArtifactActionMessage): void;
  onDownloadAllArtifacts(): void;
  onOpenExternal(url: string): void;
  onExportConsole(): void;
  onApproveInput(message: ApproveInputMessage): void;
  onRejectInput(message: RejectInputMessage): void;
  onRestartPipelineFromStage(message: RestartPipelineFromStageMessage): void;
  onSelectPipelineLogNode(message: SelectPipelineLogNodeMessage): void;
  onClearPipelineLogNode(): void;
  onExportPipelineNodeLog(): void;
  onReloadTestReport(message: ReloadTestReportMessage): void;
  onOpenTestSource(message: OpenTestSourceMessage): void;
  onOpenDiagnosticSource(message: OpenDiagnosticSourceMessage): void;
  onConfigureBuildDiagnostics(): void;
  onShowBuildDiagnosticProblems(): void;
  onBuildManagement(message: BuildManagementMessage): void;
  onPersistUiState(message: PersistUiStateMessage): void;
  onRefreshBuildDetails(): void;
  onToggleFollowLog(value: unknown): void;
}

export class BuildDetailsMessageRouter {
  private readonly routes: Array<(message: unknown) => boolean>;

  constructor(handlers: BuildDetailsMessageRouterHandlers) {
    this.routes = createMessageRoutes(handlers);
  }

  route(message: unknown): void {
    this.routes.some((route) => route(message));
  }
}

function createMessageRoutes(
  handlers: BuildDetailsMessageRouterHandlers
): Array<(message: unknown) => boolean> {
  return [
    createMessageRoute(isBuildDetailsReadyMessage, () => handlers.onBuildDetailsReady?.()),
    createMessageRoute(isSetRelatedBuildsExpandedMessage, (message) =>
      handlers.onSetRelatedBuildsExpanded?.(message.expanded)
    ),
    createMessageRoute(isRefreshRelatedBuildsMessage, () => handlers.onRefreshRelatedBuilds?.()),
    createMessageRoute(isOpenRelatedBuildMessage, (message) =>
      handlers.onOpenRelatedBuild?.(message.targetId)
    ),
    createMessageRoute(isNavigateBuildMessage, (message) =>
      handlers.onNavigateBuild?.(message.direction)
    ),
    createMessageRoute(isArtifactActionMessage, (message) => handlers.onArtifactAction(message)),
    createMessageRoute(isDownloadAllArtifactsMessage, () => handlers.onDownloadAllArtifacts()),
    createMessageRoute(isOpenExternalMessage, (message) => handlers.onOpenExternal(message.url)),
    createMessageRoute(isExportConsoleMessage, () => handlers.onExportConsole()),
    createMessageRoute(isRefreshBuildDetailsMessage, () => handlers.onRefreshBuildDetails()),
    createMessageRoute(isApproveInputMessage, (message) => handlers.onApproveInput(message)),
    createMessageRoute(isRejectInputMessage, (message) => handlers.onRejectInput(message)),
    createMessageRoute(isRestartPipelineFromStageMessage, (message) =>
      handlers.onRestartPipelineFromStage(message)
    ),
    createMessageRoute(isSelectPipelineLogNodeMessage, (message) =>
      handlers.onSelectPipelineLogNode(message)
    ),
    createMessageRoute(isClearPipelineLogNodeMessage, () => handlers.onClearPipelineLogNode()),
    createMessageRoute(isExportPipelineNodeLogMessage, () => handlers.onExportPipelineNodeLog()),
    createMessageRoute(isReloadTestReportMessage, (message) =>
      handlers.onReloadTestReport(message)
    ),
    createMessageRoute(isOpenTestSourceMessage, (message) => handlers.onOpenTestSource(message)),
    createMessageRoute(isOpenDiagnosticSourceMessage, (message) =>
      handlers.onOpenDiagnosticSource(message)
    ),
    createMessageRoute(isConfigureBuildDiagnosticsMessage, () =>
      handlers.onConfigureBuildDiagnostics()
    ),
    createMessageRoute(isShowBuildDiagnosticProblemsMessage, () =>
      handlers.onShowBuildDiagnosticProblems()
    ),
    createMessageRoute(isSetKeepForeverMessage, (message) => handlers.onBuildManagement(message)),
    createMessageRoute(isEditBuildMessage, (message) => handlers.onBuildManagement(message)),
    createMessageRoute(isDeleteBuildMessage, (message) => handlers.onBuildManagement(message)),
    createMessageRoute(isPersistUiStateMessage, (message) => handlers.onPersistUiState(message)),
    createMessageRoute(isToggleFollowLogMessage, (message) =>
      handlers.onToggleFollowLog(message.value)
    )
  ];
}

function createMessageRoute<Message>(
  guard: (message: unknown) => message is Message,
  handle: (message: Message) => void
): (message: unknown) => boolean {
  return (message) => {
    if (!guard(message)) {
      return false;
    }
    handle(message);
    return true;
  };
}
