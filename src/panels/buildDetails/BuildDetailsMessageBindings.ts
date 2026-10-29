import type { BuildDiagnosticsCoordinator } from "../../buildDiagnostics/BuildDiagnosticsCoordinator";
import { BuildDetailsMessageRouter } from "./BuildDetailsMessageRouter";
import type { BuildDetailsPanelActions } from "./BuildDetailsPanelActions";
import type { BuildDetailsPanelController } from "./BuildDetailsPanelController";
import type { PersistUiStateMessage } from "./shared/BuildDetailsPanelMessages";
import type { BuildDetailsPanelSerializedState } from "./shared/BuildDetailsPanelWebviewState";

interface BuildDetailsMessageBindings {
  actions: BuildDetailsPanelActions;
  controller: BuildDetailsPanelController;
  buildDiagnosticsCoordinator: BuildDiagnosticsCoordinator;
  getSerializedState(): BuildDetailsPanelSerializedState | undefined;
  persistUiState(message: PersistUiStateMessage): void;
  openRelatedBuild?(targetId: string): void;
  navigateBuild?(direction: "back" | "forward"): void;
  copyBuildLink?(): void;
  onBuildDetailsReady?(): void;
}

/** Connect validated webview messages to the panel's current services and state. */
export function createBuildDetailsMessageRouter({
  actions,
  controller,
  buildDiagnosticsCoordinator,
  getSerializedState,
  persistUiState,
  openRelatedBuild,
  navigateBuild,
  copyBuildLink,
  onBuildDetailsReady
}: BuildDetailsMessageBindings): BuildDetailsMessageRouter {
  return new BuildDetailsMessageRouter({
    onSetRelatedBuildsExpanded: (expanded) => controller.setRelatedBuildsExpanded(expanded),
    onRefreshRelatedBuilds: () => {
      void controller.refreshRelatedBuilds();
    },
    onOpenRelatedBuild: (targetId) => openRelatedBuild?.(targetId),
    onNavigateBuild: (direction) => navigateBuild?.(direction),
    onBuildDetailsReady: () => onBuildDetailsReady?.(),
    onDownloadAllArtifacts: () => {
      void actions.handleDownloadAllArtifacts();
    },
    onArtifactAction: (message) => {
      void actions.handleArtifactAction(message);
    },
    onOpenExternal: (url) => {
      void actions.openExternalUrl(url);
    },
    onCopyBuildLink: () => copyBuildLink?.(),
    onExportConsole: () => {
      void actions.handleExportConsole();
    },
    onRefreshBuildDetails: () => {
      const details = controller.getCurrentDetails();
      void controller.refreshBuildDetails({
        label: details?.fullDisplayName ?? details?.displayName,
        panelState: getSerializedState()
      });
    },
    onApproveInput: (message) => {
      void actions.handleApproveInput(message);
    },
    onRejectInput: (message) => {
      void actions.handleRejectInput(message);
    },
    onOpenPendingInputInJenkins: (message) => {
      void actions.handleOpenPendingInputInJenkins(message);
    },
    onRestartPipelineFromStage: (message) => {
      void actions.handleRestartPipelineFromStage(message);
    },
    onSelectPipelineLogNode: (message) => {
      actions.handleSelectPipelineLogNode(message);
    },
    onClearPipelineLogNode: () => {
      actions.handleClearPipelineLogNode();
    },
    onExportPipelineNodeLog: () => {
      void actions.handleExportPipelineNodeLog();
    },
    onReloadTestReport: (message) => {
      void actions.handleReloadTestReport(message);
    },
    onOpenTestSource: (message) => {
      void actions.handleOpenTestSource(message);
    },
    onOpenDiagnosticSource: (message) => {
      void buildDiagnosticsCoordinator.openSourceTarget(message.targetId, controller.getBuildUrl());
    },
    onConfigureBuildDiagnostics: () => {
      void buildDiagnosticsCoordinator.configure();
    },
    onShowBuildDiagnosticProblems: () => {
      buildDiagnosticsCoordinator.showProblems();
    },
    onBuildManagement: (message) => {
      void actions.handleBuildManagement(message);
    },
    onPersistUiState: (message) => {
      persistUiState(message);
    },
    onToggleFollowLog: (value) => {
      controller.setFollowLog(Boolean(value));
    }
  });
}
