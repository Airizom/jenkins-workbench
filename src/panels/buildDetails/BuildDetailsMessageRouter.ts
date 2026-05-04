import {
  type ApproveInputMessage,
  type ArtifactActionMessage,
  type OpenTestSourceMessage,
  type PersistUiStateMessage,
  type RejectInputMessage,
  type ReloadTestReportMessage,
  type RestartPipelineFromStageMessage,
  type SelectPipelineLogNodeMessage,
  isApproveInputMessage,
  isArtifactActionMessage,
  isClearPipelineLogNodeMessage,
  isExportConsoleMessage,
  isExportPipelineNodeLogMessage,
  isOpenExternalMessage,
  isOpenTestSourceMessage,
  isPersistUiStateMessage,
  isRejectInputMessage,
  isReloadTestReportMessage,
  isRestartPipelineFromStageMessage,
  isSelectPipelineLogNodeMessage,
  isToggleFollowLogMessage
} from "./BuildDetailsMessages";

export interface BuildDetailsMessageRouterHandlers {
  onArtifactAction(message: ArtifactActionMessage): void;
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
  onPersistUiState(message: PersistUiStateMessage): void;
  onToggleFollowLog(value: unknown): void;
}

export class BuildDetailsMessageRouter {
  constructor(private readonly handlers: BuildDetailsMessageRouterHandlers) {}

  route(message: unknown): void {
    if (isArtifactActionMessage(message)) {
      this.handlers.onArtifactAction(message);
      return;
    }
    if (isOpenExternalMessage(message)) {
      this.handlers.onOpenExternal(message.url);
      return;
    }
    if (isExportConsoleMessage(message)) {
      this.handlers.onExportConsole();
      return;
    }
    if (isApproveInputMessage(message)) {
      this.handlers.onApproveInput(message);
      return;
    }
    if (isRejectInputMessage(message)) {
      this.handlers.onRejectInput(message);
      return;
    }
    if (isRestartPipelineFromStageMessage(message)) {
      this.handlers.onRestartPipelineFromStage(message);
      return;
    }
    if (isSelectPipelineLogNodeMessage(message)) {
      this.handlers.onSelectPipelineLogNode(message);
      return;
    }
    if (isClearPipelineLogNodeMessage(message)) {
      this.handlers.onClearPipelineLogNode();
      return;
    }
    if (isExportPipelineNodeLogMessage(message)) {
      this.handlers.onExportPipelineNodeLog();
      return;
    }
    if (isReloadTestReportMessage(message)) {
      this.handlers.onReloadTestReport(message);
      return;
    }
    if (isOpenTestSourceMessage(message)) {
      this.handlers.onOpenTestSource(message);
      return;
    }
    if (isPersistUiStateMessage(message)) {
      this.handlers.onPersistUiState(message);
      return;
    }
    if (isToggleFollowLogMessage(message)) {
      this.handlers.onToggleFollowLog(message.value);
    }
  }
}
