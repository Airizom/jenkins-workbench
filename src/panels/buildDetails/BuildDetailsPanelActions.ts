import * as vscode from "vscode";
import type { EnvironmentScopedRefreshHost } from "../../extension/ExtensionRefreshHost";
import { formatActionError } from "../../formatters/ErrorFormatters";
import type { BuildConsoleExporter } from "../../services/BuildConsoleExporter";
import type { TestSourceNavigationUiService } from "../../services/TestSourceNavigationUiService";
import { buildTestSourceNavigationContext } from "../../services/TestSourceResolver";
import type { ArtifactActionHandler } from "../../ui/ArtifactActionHandler";
import { openExternalHttpUrlWithWarning } from "../../ui/OpenExternalUrl";
import { handlePendingInputAction } from "../../ui/PendingInputActions";
import { MAX_CONSOLE_CHARS } from "./BuildDetailsConfig";
import type { BuildDetailsPanelControllerAccess } from "./BuildDetailsPanelController";
import { isPipelineRestartEligible } from "./PipelineRestartEligibility";
import type { PipelineLogTargetViewModel } from "./shared/BuildDetailsContracts";

interface BuildDetailsPanelActionsOptions {
  controller: BuildDetailsPanelControllerAccess;
  getArtifactActionHandler: () => ArtifactActionHandler | undefined;
  getConsoleExporter: () => BuildConsoleExporter;
  getRefreshHost: () => EnvironmentScopedRefreshHost | undefined;
  getTestSourceNavigationUiService: () => TestSourceNavigationUiService | undefined;
}

interface PendingInputContext {
  pendingInputService: NonNullable<
    ReturnType<BuildDetailsPanelControllerAccess["getBackend"]>
  >["pendingInputs"];
  environment: NonNullable<ReturnType<BuildDetailsPanelControllerAccess["getEnvironment"]>>;
  buildUrl: string;
  environmentId: string;
  label: string;
}

export class BuildDetailsPanelActions {
  private readonly controller: BuildDetailsPanelControllerAccess;
  private readonly getArtifactActionHandler: () => ArtifactActionHandler | undefined;
  private readonly getConsoleExporter: () => BuildConsoleExporter;
  private readonly getRefreshHost: () => EnvironmentScopedRefreshHost | undefined;
  private readonly getTestSourceNavigationUiService: () =>
    | TestSourceNavigationUiService
    | undefined;

  constructor(options: BuildDetailsPanelActionsOptions) {
    this.controller = options.controller;
    this.getArtifactActionHandler = options.getArtifactActionHandler;
    this.getConsoleExporter = options.getConsoleExporter;
    this.getRefreshHost = options.getRefreshHost;
    this.getTestSourceNavigationUiService = options.getTestSourceNavigationUiService;
  }

  async handleApproveInput(message: { inputId: string }): Promise<void> {
    const context = this.getPendingInputContext();
    if (!context) {
      void vscode.window.showErrorMessage("Build details are not ready for input approval.");
      return;
    }
    await handlePendingInputAction({
      dataService: context.pendingInputService,
      environment: context.environment,
      buildUrl: context.buildUrl,
      label: context.label,
      inputId: message.inputId,
      action: "approve",
      onRefresh: () => this.refreshAfterPendingInputAction(context.environmentId)
    });
  }

  async handleRejectInput(message: { inputId: string }): Promise<void> {
    const context = this.getPendingInputContext();
    if (!context) {
      void vscode.window.showErrorMessage("Build details are not ready for input rejection.");
      return;
    }
    await handlePendingInputAction({
      dataService: context.pendingInputService,
      environment: context.environment,
      buildUrl: context.buildUrl,
      label: context.label,
      inputId: message.inputId,
      action: "reject",
      onRefresh: () => this.refreshAfterPendingInputAction(context.environmentId)
    });
  }

  private async refreshAfterPendingInputAction(environmentId: string): Promise<void> {
    await this.controller.refreshPendingInputs();
    await this.controller.refreshBuildStatus(this.controller.getLoadToken());
    this.getRefreshHost()?.fullEnvironmentRefresh({ environmentId });
  }

  private getPendingInputContext(): PendingInputContext | undefined {
    const pendingInputService = this.controller.getBackend()?.pendingInputs;
    const environment = this.controller.getEnvironment();
    const buildUrl = this.controller.getBuildUrl();
    if (!pendingInputService || !environment || !buildUrl) {
      return undefined;
    }
    const details = this.controller.getCurrentDetails();
    return {
      pendingInputService,
      environment,
      buildUrl,
      environmentId: environment.environmentId,
      label: details?.fullDisplayName ?? details?.displayName ?? "build"
    };
  }

  async handleRestartPipelineFromStage(message: { stageName: string }): Promise<void> {
    const restartBackend = this.controller.getBackend()?.restart;
    const environment = this.controller.getEnvironment();
    const buildUrl = this.controller.getBuildUrl();
    const details = this.controller.getCurrentDetails();
    if (!restartBackend || !environment || !buildUrl) {
      void vscode.window.showErrorMessage(
        "Build details are not ready to restart a pipeline from stage."
      );
      return;
    }
    if (!details) {
      void vscode.window.showErrorMessage(
        "Build details are still loading. Try restarting from stage again."
      );
      return;
    }
    if (details.building) {
      void vscode.window.showInformationMessage(
        "This build is still running. Restart from stage is available after it completes."
      );
      return;
    }
    if (!isPipelineRestartEligible(details)) {
      void vscode.window.showInformationMessage(
        "Restart from stage is only available for failed or unstable completed builds."
      );
      return;
    }
    if (this.controller.getPipelineRestartAvailability() === "unsupported") {
      void vscode.window.showInformationMessage(
        "Restart from stage is not available on this Jenkins instance."
      );
      return;
    }
    const stageName = message.stageName.trim();
    if (!stageName) {
      void vscode.window.showErrorMessage("Select a valid stage to restart from.");
      return;
    }

    const isRestartable =
      this.controller.getPipelineRestartEnabled() &&
      this.controller.getPipelineRestartableStages().includes(stageName);
    if (!isRestartable) {
      void vscode.window.showErrorMessage(
        `Stage "${stageName}" is not restartable for this build. Refresh pipeline details and try again.`
      );
      return;
    }

    const environmentId = environment.environmentId;
    const label = details.fullDisplayName ?? details.displayName ?? `#${details.number}`;
    this.controller.beginLoading();
    try {
      await restartBackend.restartPipelineFromStage(environment, buildUrl, stageName);
      void vscode.window.showInformationMessage(
        `Requested restart from stage "${stageName}" for ${label}.`
      );
      this.getRefreshHost()?.fullEnvironmentRefresh({ environmentId: environmentId });
    } catch (error) {
      void vscode.window.showErrorMessage(
        `Failed to restart ${label} from stage "${stageName}": ${formatActionError(error)}`
      );
    } finally {
      this.controller.endLoading();
    }
  }

  handleSelectPipelineLogNode(message: { target: PipelineLogTargetViewModel }): void {
    this.controller.selectPipelineLogTarget(message.target);
  }

  handleClearPipelineLogNode(): void {
    this.controller.clearPipelineLogTarget();
  }

  async handleArtifactAction(message: {
    action: "preview" | "download";
    relativePath: string;
    fileName?: string;
  }): Promise<void> {
    const artifactActionHandler = this.getArtifactActionHandler();
    const environment = this.controller.getEnvironment();
    const buildUrl = this.controller.getBuildUrl();
    const details = this.controller.getCurrentDetails();
    if (!artifactActionHandler || !environment || !buildUrl) {
      return;
    }
    const fileName =
      typeof message.fileName === "string" && message.fileName.length > 0
        ? message.fileName
        : undefined;
    const jobNameHint =
      details?.fullDisplayName?.trim() || details?.displayName?.trim() || undefined;
    await artifactActionHandler.handle({
      action: message.action,
      environment,
      buildUrl,
      buildNumber: details?.number,
      relativePath: message.relativePath,
      fileName,
      jobNameHint
    });
  }

  async handleReloadTestReport(message: { includeCaseLogs?: boolean }): Promise<void> {
    const details = this.controller.getCurrentDetails();
    if (!details || details.building) {
      return;
    }

    await this.controller.refreshTestReport(this.controller.getLoadToken(), {
      includeCaseLogs: message.includeCaseLogs,
      showLoading: true
    });
  }

  async handleOpenTestSource(message: {
    testName: string;
    className?: string;
    suiteName?: string;
  }): Promise<void> {
    const environment = this.controller.getEnvironment();
    const buildUrl = this.controller.getBuildUrl();
    const service = this.getTestSourceNavigationUiService();
    if (!environment || !buildUrl || !service) {
      void vscode.window.showInformationMessage(
        "Test source navigation is unavailable for this workspace."
      );
      return;
    }
    await service.openTestSource(buildTestSourceNavigationContext(environment, buildUrl), {
      testName: message.testName,
      className: message.className,
      suiteName: message.suiteName
    });
  }

  async handleExportConsole(): Promise<void> {
    const environment = this.controller.getEnvironment();
    const buildUrl = this.controller.getBuildUrl();
    const details = this.controller.getCurrentDetails();
    if (!environment || !buildUrl) {
      void vscode.window.showErrorMessage("Build details are not ready to export console output.");
      return;
    }

    const consoleExporter = this.getConsoleExporter();
    const defaultFileName = consoleExporter.getDefaultFileName(details);
    const workspaceUri = vscode.workspace.workspaceFolders?.[0]?.uri;
    const defaultUri = workspaceUri
      ? vscode.Uri.joinPath(workspaceUri, defaultFileName)
      : undefined;
    const targetUri = await vscode.window.showSaveDialog({
      title: "Export Jenkins Console Output",
      saveLabel: "Export Logs",
      defaultUri,
      filters: {
        "Log files": ["log", "txt"]
      }
    });

    if (!targetUri) {
      return;
    }
    if (!targetUri.fsPath) {
      void vscode.window.showErrorMessage("Export logs requires a file system path.");
      return;
    }

    try {
      const result = await consoleExporter.exportToFile({
        environment,
        buildUrl,
        targetPath: targetUri.fsPath
      });
      if (result.mode === "tail" || result.truncated) {
        void vscode.window.showWarningMessage(
          `Saved last ${MAX_CONSOLE_CHARS.toLocaleString()} characters of console output to ${
            targetUri.fsPath
          }.`
        );
        return;
      }
      void vscode.window.showInformationMessage(`Saved console output to ${targetUri.fsPath}.`);
    } catch (error) {
      void vscode.window.showErrorMessage(
        `Failed to export console output: ${formatActionError(error)}`
      );
    }
  }

  async handleExportPipelineNodeLog(): Promise<void> {
    const log = this.controller.getCurrentPipelineNodeLog();
    const target = log?.target;
    if (!target) {
      void vscode.window.showErrorMessage("Select a pipeline stage or step log before exporting.");
      return;
    }
    if (!log.text.trim()) {
      void vscode.window.showErrorMessage("The selected pipeline log is empty.");
      return;
    }

    const workspaceUri = vscode.workspace.workspaceFolders?.[0]?.uri;
    const defaultFileName = `jenkins-${sanitizeFilePart(target.name)}-${target.kind}-log.txt`;
    const defaultUri = workspaceUri
      ? vscode.Uri.joinPath(workspaceUri, defaultFileName)
      : undefined;
    const targetUri = await vscode.window.showSaveDialog({
      title: "Export Pipeline Node Log",
      saveLabel: "Export Log",
      defaultUri,
      filters: {
        "Log files": ["log", "txt"]
      }
    });
    if (!targetUri) {
      return;
    }
    try {
      await vscode.workspace.fs.writeFile(targetUri, Buffer.from(log.text, "utf8"));
      void vscode.window.showInformationMessage(`Saved ${target.name} log to ${targetUri.fsPath}.`);
    } catch (error) {
      void vscode.window.showErrorMessage(
        `Failed to export ${target.name} log: ${formatActionError(error)}`
      );
    }
  }

  async openExternalUrl(url: string): Promise<void> {
    await openExternalHttpUrlWithWarning(url, {
      targetLabel: "Jenkins URL",
      sourceLabel: "Build Details"
    });
  }
}

function sanitizeFilePart(value: string): string {
  const sanitized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return sanitized || "pipeline-node";
}
