import * as vscode from "vscode";
import { formatActionError } from "../../formatters/ErrorFormatters";
import type { BuildConsoleExporter } from "../../services/BuildConsoleExporter";
import type { ArtifactActionHandler } from "../../ui/ArtifactActionHandler";
import { openExternalHttpUrlWithWarning } from "../../ui/OpenExternalUrl";
import { handlePendingInputAction } from "../../ui/PendingInputActions";
import { MAX_CONSOLE_CHARS } from "./BuildDetailsConfig";
import type { BuildDetailsPanelControllerAccess } from "./BuildDetailsPanelController";
import { isPipelineRestartEligible } from "./PipelineRestartEligibility";

interface BuildDetailsPanelActionsOptions {
  controller: BuildDetailsPanelControllerAccess;
  getArtifactActionHandler: () => ArtifactActionHandler | undefined;
  getConsoleExporter: () => BuildConsoleExporter;
  getRefreshHost: () => { refreshEnvironment(environmentId: string): void } | undefined;
}

export class BuildDetailsPanelActions {
  private readonly controller: BuildDetailsPanelControllerAccess;
  private readonly getArtifactActionHandler: () => ArtifactActionHandler | undefined;
  private readonly getConsoleExporter: () => BuildConsoleExporter;
  private readonly getRefreshHost: () =>
    | { refreshEnvironment(environmentId: string): void }
    | undefined;

  constructor(options: BuildDetailsPanelActionsOptions) {
    this.controller = options.controller;
    this.getArtifactActionHandler = options.getArtifactActionHandler;
    this.getConsoleExporter = options.getConsoleExporter;
    this.getRefreshHost = options.getRefreshHost;
  }

  async handleApproveInput(message: { inputId: string }): Promise<void> {
    const dataService = this.controller.getDataService();
    const environment = this.controller.getEnvironment();
    const buildUrl = this.controller.getBuildUrl();
    const details = this.controller.getCurrentDetails();
    if (!dataService || !environment || !buildUrl) {
      void vscode.window.showErrorMessage("Build details are not ready for input approval.");
      return;
    }
    const environmentId = environment.environmentId;
    const label = details?.fullDisplayName ?? details?.displayName ?? "build";
    await handlePendingInputAction({
      dataService,
      environment,
      buildUrl,
      label,
      inputId: message.inputId,
      action: "approve",
      onRefresh: async () => {
        await this.controller.refreshPendingInputs();
        await this.controller.refreshBuildStatus(this.controller.getLoadToken());
        this.getRefreshHost()?.refreshEnvironment(environmentId);
      }
    });
  }

  async handleRejectInput(message: { inputId: string }): Promise<void> {
    const dataService = this.controller.getDataService();
    const environment = this.controller.getEnvironment();
    const buildUrl = this.controller.getBuildUrl();
    const details = this.controller.getCurrentDetails();
    if (!dataService || !environment || !buildUrl) {
      void vscode.window.showErrorMessage("Build details are not ready for input rejection.");
      return;
    }
    const environmentId = environment.environmentId;
    const label = details?.fullDisplayName ?? details?.displayName ?? "build";
    await handlePendingInputAction({
      dataService,
      environment,
      buildUrl,
      label,
      inputId: message.inputId,
      action: "reject",
      onRefresh: async () => {
        await this.controller.refreshPendingInputs();
        await this.controller.refreshBuildStatus(this.controller.getLoadToken());
        this.getRefreshHost()?.refreshEnvironment(environmentId);
      }
    });
  }

  async handleRestartPipelineFromStage(message: { stageName: string }): Promise<void> {
    const dataService = this.controller.getDataService();
    const environment = this.controller.getEnvironment();
    const buildUrl = this.controller.getBuildUrl();
    const details = this.controller.getCurrentDetails();
    if (!dataService || !environment || !buildUrl) {
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
      await dataService.restartPipelineFromStage(environment, buildUrl, stageName);
      void vscode.window.showInformationMessage(
        `Requested restart from stage "${stageName}" for ${label}.`
      );
      this.getRefreshHost()?.refreshEnvironment(environmentId);
    } catch (error) {
      void vscode.window.showErrorMessage(
        `Failed to restart ${label} from stage "${stageName}": ${formatActionError(error)}`
      );
    } finally {
      this.controller.endLoading();
    }
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

  async handleExportConsole(): Promise<void> {
    const dataService = this.controller.getDataService();
    const environment = this.controller.getEnvironment();
    const buildUrl = this.controller.getBuildUrl();
    const details = this.controller.getCurrentDetails();
    if (!dataService || !environment || !buildUrl) {
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

  async openExternalUrl(url: string): Promise<void> {
    await openExternalHttpUrlWithWarning(url, {
      targetLabel: "Jenkins URL",
      sourceLabel: "Build Details"
    });
  }
}
