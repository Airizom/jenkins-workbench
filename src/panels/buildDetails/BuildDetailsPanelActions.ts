import * as vscode from "vscode";
import type { EnvironmentScopedRefreshHost } from "../../extension/ExtensionRefreshHost";
import { formatActionError } from "../../formatters/ErrorFormatters";
import { buildPendingInputBrowserUrl } from "../../jenkins/urls";
import type { BuildConsoleExporter } from "../../services/BuildConsoleExporter";
import type {
  BuildManagementResult,
  BuildManagementTarget,
  BuildManagementWorkflow
} from "../../services/build/BuildManagementWorkflow";
import type { BuildFollowUpService } from "../../services/buildFollow/BuildFollowUpService";
import type { TestSourceNavigationUiService } from "../../services/TestSourceNavigationUiService";
import { buildTestSourceNavigationContext } from "../../services/TestSourceResolver";
import type { ArtifactActionHandler } from "../../ui/ArtifactActionHandler";
import { openExternalHttpUrlWithWarning } from "../../ui/OpenExternalUrl";
import { handlePendingInputAction } from "../../ui/PendingInputActions";
import { MAX_CONSOLE_CHARS } from "./BuildDetailsConfig";
import type { BuildDetailsPanelControllerAccess } from "./BuildDetailsPanelController";
import { isPipelineRestartEligible } from "./PipelineRestartEligibility";
import type { PipelineLogTargetViewModel } from "./shared/BuildDetailsContracts";
import type { BuildManagementMessage } from "./shared/BuildDetailsPanelMessages";

interface BuildDetailsPanelActionsOptions {
  controller: BuildDetailsPanelControllerAccess;
  getArtifactActionHandler: () => ArtifactActionHandler | undefined;
  getConsoleExporter: () => BuildConsoleExporter;
  getRefreshHost: () => EnvironmentScopedRefreshHost | undefined;
  getTestSourceNavigationUiService: () => TestSourceNavigationUiService | undefined;
  getBuildManagementWorkflow: () => BuildManagementWorkflow | undefined;
  getBuildFollowUp?: () => BuildFollowUpService | undefined;
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
  private readonly getBuildManagementWorkflow: () => BuildManagementWorkflow | undefined;
  private readonly getBuildFollowUp: () => BuildFollowUpService | undefined;

  constructor(options: BuildDetailsPanelActionsOptions) {
    this.controller = options.controller;
    this.getArtifactActionHandler = options.getArtifactActionHandler;
    this.getConsoleExporter = options.getConsoleExporter;
    this.getRefreshHost = options.getRefreshHost;
    this.getTestSourceNavigationUiService = options.getTestSourceNavigationUiService;
    this.getBuildManagementWorkflow = options.getBuildManagementWorkflow;
    this.getBuildFollowUp = options.getBuildFollowUp ?? (() => undefined);
  }

  /**
   * Runs a keep-forever, edit, or delete request from the hero. The webview keeps its
   * management buttons disabled until `buildManagementActionComplete` arrives.
   */
  async handleBuildManagement(message: BuildManagementMessage): Promise<void> {
    try {
      const workflow = this.getBuildManagementWorkflow();
      const target = this.getBuildManagementTarget();
      if (!workflow || !target) {
        void vscode.window.showErrorMessage("Build details are not ready.");
        return;
      }
      const result = await runBuildManagementAction(workflow, target, message);
      if (result === "changed") {
        // The data service drops cached details on every mutation, so this re-reads the
        // display name, description, and keep-forever state and posts them to the webview.
        await this.controller.refreshBuildStatus(this.controller.getLoadToken());
      }
    } catch (error) {
      // The workflow reports Jenkins errors itself; this only covers unexpected failures.
      void vscode.window.showErrorMessage(
        `Build management action failed: ${formatActionError(error)}`
      );
    } finally {
      // A "deleted" result has already closed the panel; the controller ignores posts
      // after disposal.
      this.controller.postMessage({ type: "buildManagementActionComplete" });
    }
  }

  private getBuildManagementTarget(): BuildManagementTarget | undefined {
    const environment = this.controller.getEnvironment();
    const buildUrl = this.controller.getBuildUrl();
    const details = this.controller.getCurrentDetails();
    if (!environment || !buildUrl || !details) {
      return undefined;
    }
    return {
      environment,
      buildUrl,
      label: details.fullDisplayName ?? details.displayName ?? `#${details.number}`,
      isBuilding: Boolean(details.building)
    };
  }

  async handleApproveInput(message: { inputId: string }): Promise<void> {
    await this.handlePendingInput(message, "approve", "approval");
  }

  async handleRejectInput(message: { inputId: string }): Promise<void> {
    await this.handlePendingInput(message, "reject", "rejection");
  }

  /**
   * Opens the build's Jenkins input page for inputs whose values can't be entered in VS Code.
   * The URL comes from the panel's build, never from the webview.
   */
  async handleOpenPendingInputInJenkins(_message: { inputId: string }): Promise<void> {
    const buildUrl = this.controller.getBuildUrl();
    if (!buildUrl) {
      void vscode.window.showErrorMessage("Build details are not ready for input approval.");
      return;
    }
    await openExternalHttpUrlWithWarning(buildPendingInputBrowserUrl(buildUrl), {
      targetLabel: "Jenkins input page",
      sourceLabel: "Build Details"
    });
  }

  private async handlePendingInput(
    message: { inputId: string },
    action: "approve" | "reject",
    readinessAction: "approval" | "rejection"
  ): Promise<void> {
    try {
      const context = this.getPendingInputContext();
      if (!context) {
        void vscode.window.showErrorMessage(
          `Build details are not ready for input ${readinessAction}.`
        );
        return;
      }
      await handlePendingInputAction({
        dataService: context.pendingInputService,
        environment: context.environment,
        buildUrl: context.buildUrl,
        label: context.label,
        inputId: message.inputId,
        action,
        onRefresh: () => this.refreshAfterPendingInputAction(context.environmentId)
      });
    } finally {
      // The webview keeps the input's buttons disabled until this arrives, so a
      // parameter prompt or confirmation left open cannot lead to a double submit.
      this.controller.postMessage({
        type: "pendingInputActionComplete",
        inputId: message.inputId
      });
    }
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
    const stageName = message.stageName;
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
    if (!(await confirmRestartFromStage(label, stageName))) {
      return;
    }
    const loadingRequest = this.controller.beginLoading();
    try {
      const buildFollowUp = this.getBuildFollowUp();
      // Read the next build number before submitting so the new build can be told apart.
      const prepared = await buildFollowUp?.prepare({
        kind: "cause",
        environment,
        sourceBuildUrl: buildUrl,
        cause: "restart",
        stageName
      });
      await restartBackend.restartPipelineFromStage(environment, buildUrl, stageName);
      const requestedMessage = `Requested restart from stage "${stageName}" for ${label}`;
      const refresh = () =>
        this.getRefreshHost()?.fullEnvironmentRefresh({ environmentId: environmentId });
      if (buildFollowUp && prepared) {
        buildFollowUp.announceAndFollow(prepared, { requestedMessage, refresh });
      } else {
        void vscode.window.showInformationMessage(`${requestedMessage}.`);
        refresh();
      }
    } catch (error) {
      void vscode.window.showErrorMessage(
        `Failed to restart ${label} from stage "${stageName}": ${formatActionError(error)}`
      );
    } finally {
      this.controller.endLoading(loadingRequest);
    }
  }

  handleSelectPipelineLogNode(message: { target: PipelineLogTargetViewModel }): void {
    this.controller.selectPipelineLogTarget(message.target);
  }

  handleClearPipelineLogNode(): void {
    this.controller.clearPipelineLogTarget();
  }

  async handleDownloadAllArtifacts(): Promise<void> {
    await this.handleArtifactRequest({ action: "downloadAll" });
  }

  async handleArtifactAction(message: {
    action: "preview" | "download";
    relativePath: string;
    fileName?: string;
  }): Promise<void> {
    const fileName =
      typeof message.fileName === "string" && message.fileName.length > 0
        ? message.fileName
        : undefined;
    await this.handleArtifactRequest({
      action: message.action,
      relativePath: message.relativePath,
      fileName
    });
  }

  private async handleArtifactRequest(
    request:
      | { action: "downloadAll" }
      | { action: "preview" | "download"; relativePath: string; fileName?: string }
  ): Promise<void> {
    const artifactActionHandler = this.getArtifactActionHandler();
    const environment = this.controller.getEnvironment();
    const buildUrl = this.controller.getBuildUrl();
    const details = this.controller.getCurrentDetails();
    if (!artifactActionHandler || !environment || !buildUrl) {
      return;
    }
    await artifactActionHandler.handle({
      ...request,
      environment,
      buildUrl,
      buildNumber: details?.number,
      jobNameHint: details?.fullDisplayName?.trim() || details?.displayName?.trim() || undefined
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
    const targetUri = await promptLogSaveTarget(
      "Export Jenkins Console Output",
      "Export Logs",
      consoleExporter.getDefaultFileName(details)
    );

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

    const targetUri = await promptLogSaveTarget(
      "Export Pipeline Node Log",
      "Export Log",
      `jenkins-${sanitizeFilePart(target.name)}-${target.kind}-log.txt`
    );
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

function runBuildManagementAction(
  workflow: BuildManagementWorkflow,
  target: BuildManagementTarget,
  message: BuildManagementMessage
): Promise<BuildManagementResult> {
  switch (message.type) {
    case "setKeepForever":
      // Apply the state the hero button offered, not whatever Jenkins holds now: a
      // stale panel must not release a build that was kept from the tree meanwhile.
      return workflow.setKeepForever(target, message.keep);
    case "editBuild":
      return workflow.editBuild(target);
    case "deleteBuild":
      return workflow.deleteBuild(target);
  }
}

const RESTART_CONFIRM_LABEL = "Restart";

async function confirmRestartFromStage(label: string, stageName: string): Promise<boolean> {
  const choice = await vscode.window.showWarningMessage(
    `Restart ${label} from stage “${stageName}”? This starts a new build.`,
    { modal: true },
    RESTART_CONFIRM_LABEL
  );
  return choice === RESTART_CONFIRM_LABEL;
}

function promptLogSaveTarget(
  title: string,
  saveLabel: string,
  defaultFileName: string
): Thenable<vscode.Uri | undefined> {
  const workspaceUri = vscode.workspace.workspaceFolders?.[0]?.uri;
  const defaultUri = workspaceUri ? vscode.Uri.joinPath(workspaceUri, defaultFileName) : undefined;
  return vscode.window.showSaveDialog({
    title,
    saveLabel,
    defaultUri,
    filters: {
      "Log files": ["log", "txt"]
    }
  });
}

function sanitizeFilePart(value: string): string {
  const sanitized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return sanitized || "pipeline-node";
}
