import * as vscode from "vscode";
import type { ArtifactActionHandler } from "../ui/ArtifactActionHandler";
import { BuildActionError } from "../jenkins/errors";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import { toPipelineRun } from "../jenkins/pipeline/JenkinsPipelineAdapter";
import type { JenkinsBuildDetails } from "../jenkins/types";
import type { BuildConsoleExporter } from "../services/BuildConsoleExporter";
import { handlePendingInputAction } from "../ui/PendingInputActions";
import { BuildDetailsCompletionPoller } from "./buildDetails/BuildDetailsCompletionPoller";
import {
  MAX_CONSOLE_CHARS,
  getBuildDetailsRefreshIntervalMs,
  getTestReportIncludeCaseLogs,
  getTestReportIncludeCaseLogsConfigKey
} from "./buildDetails/BuildDetailsConfig";
import { formatError, formatResult } from "./buildDetails/BuildDetailsFormatters";
import { createBuildDetailsPollingCallbacks } from "./buildDetails/BuildDetailsPollingCallbacks";
import {
  type BuildDetailsOutgoingMessage,
  isApproveInputMessage,
  isArtifactActionMessage,
  isExportConsoleMessage,
  isOpenExternalMessage,
  isRejectInputMessage,
  isToggleFollowLogMessage
} from "./buildDetails/BuildDetailsMessages";
import {
  type BuildDetailsDataService,
  type BuildDetailsInitialState,
  type PendingInputActionProvider,
  BuildDetailsPollingController
} from "./buildDetails/BuildDetailsPollingController";
import { BuildDetailsPanelState } from "./buildDetails/BuildDetailsPanelState";
import { renderBuildDetailsHtml, renderLoadingHtml } from "./buildDetails/BuildDetailsRenderer";
import { buildUpdateMessageFromState } from "./buildDetails/BuildDetailsUpdateBuilder";
import { buildBuildDetailsViewModel } from "./buildDetails/BuildDetailsViewModel";
import {
  BUILD_DETAILS_WEBVIEW_BUNDLE_PATH,
  BUILD_DETAILS_WEBVIEW_CSS_PATH
} from "./buildDetails/BuildDetailsWebviewAssets";
import { createNonce } from "./buildDetails/BuildDetailsWebviewUtils";

export class BuildDetailsPanel {
  private static currentPanel: BuildDetailsPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private consoleExporter: BuildConsoleExporter;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly completionPoller: BuildDetailsCompletionPoller;
  private readonly state = new BuildDetailsPanelState();
  private loadToken = 0;
  private dataService?: BuildDetailsDataService;
  private artifactActionHandler?: ArtifactActionHandler;
  private pollingController?: BuildDetailsPollingController;
  private refreshHost?: { refreshEnvironment(environmentId: string): void };
  private pendingInputProvider?: PendingInputActionProvider;

  static async show(
    dataService: BuildDetailsDataService,
    artifactActionHandler: ArtifactActionHandler,
    consoleExporter: BuildConsoleExporter,
    refreshHost: { refreshEnvironment(environmentId: string): void } | undefined,
    pendingInputProvider: PendingInputActionProvider | undefined,
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    extensionUri: vscode.Uri,
    label?: string
  ): Promise<void> {
    const bundleSegments = BUILD_DETAILS_WEBVIEW_BUNDLE_PATH.split("/");
    const bundleRootSegments = bundleSegments.slice(0, -1);
    if (!BuildDetailsPanel.currentPanel) {
      const panel = vscode.window.createWebviewPanel(
        "jenkinsWorkbench.buildDetails",
        "Build Details",
        vscode.ViewColumn.Active,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [vscode.Uri.joinPath(extensionUri, ...bundleRootSegments)]
        }
      );
      BuildDetailsPanel.currentPanel = new BuildDetailsPanel(panel, extensionUri, consoleExporter);
    }

    const activePanel = BuildDetailsPanel.currentPanel;
    activePanel.consoleExporter = consoleExporter;
    activePanel.refreshHost = refreshHost;
    activePanel.pendingInputProvider = pendingInputProvider;
    activePanel.panel.reveal(undefined, true);
    await activePanel.load(dataService, artifactActionHandler, environment, buildUrl, label);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    consoleExporter: BuildConsoleExporter
  ) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.consoleExporter = consoleExporter;
    this.completionPoller = new BuildDetailsCompletionPoller({
      getRefreshIntervalMs: () => getBuildDetailsRefreshIntervalMs(),
      fetchBuildDetails: (token) => this.fetchBuildDetails(token),
      isTokenCurrent: (token) => this.isTokenCurrent(token),
      shouldPoll: () => this.state.lastDetailsBuilding,
      onDetailsUpdate: (details) => this.applyDetailsUpdate(details, false)
    });
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.onDidChangeViewState(
      () => {
        if (this.panel.visible) {
          void this.handlePanelVisible();
        } else {
          this.handlePanelHidden();
        }
      },
      null,
      this.disposables
    );
    this.panel.webview.onDidReceiveMessage(
      (message: unknown) => {
        if (isArtifactActionMessage(message)) {
          void this.handleArtifactAction(message);
          return;
        }
        if (isOpenExternalMessage(message)) {
          void this.openExternalUrl(message.url);
          return;
        }
        if (isExportConsoleMessage(message)) {
          void this.handleExportConsole();
          return;
        }
        if (isApproveInputMessage(message)) {
          void this.handleApproveInput(message);
          return;
        }
        if (isRejectInputMessage(message)) {
          void this.handleRejectInput(message);
          return;
        }
        if (isToggleFollowLogMessage(message)) {
          this.state.setFollowLog(Boolean(message.value));
        }
      },
      null,
      this.disposables
    );
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (!event.affectsConfiguration(getTestReportIncludeCaseLogsConfigKey())) {
          return;
        }
        this.pollingController?.setTestReportOptions({
          includeCaseLogs: getTestReportIncludeCaseLogs()
        });
      })
    );
  }

  private dispose(): void {
    this.pollingController?.dispose();
    this.pollingController = undefined;
    this.stopCompletionPolling();
    BuildDetailsPanel.currentPanel = undefined;
    while (this.disposables.length > 0) {
      const disposable = this.disposables.pop();
      disposable?.dispose();
    }
  }

  private async load(
    dataService: BuildDetailsDataService,
    artifactActionHandler: ArtifactActionHandler,
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    label?: string
  ): Promise<void> {
    const token = ++this.loadToken;
    this.pollingController?.dispose();
    this.pollingController = undefined;
    this.stopCompletionPolling();
    this.dataService = dataService;
    this.artifactActionHandler = artifactActionHandler;
    this.state.resetForLoad(environment, buildUrl, createNonce());
    const styleSegments = BUILD_DETAILS_WEBVIEW_CSS_PATH.split("/");
    const styleUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, ...styleSegments)
    );

    this.panel.webview.html = renderLoadingHtml({
      cspSource: this.panel.webview.cspSource,
      nonce: this.state.currentNonce,
      styleUri: styleUri.toString()
    });

    this.pollingController = new BuildDetailsPollingController({
      dataService,
      pendingInputProvider: this.pendingInputProvider,
      environment,
      buildUrl,
      maxConsoleChars: MAX_CONSOLE_CHARS,
      getRefreshIntervalMs: () => getBuildDetailsRefreshIntervalMs(),
      testReportOptions: { includeCaseLogs: getTestReportIncludeCaseLogs() },
      formatError,
      callbacks: createBuildDetailsPollingCallbacks(this.state, token, {
        postMessage: (message) => this.postMessage(message),
        setTitle: (title) => {
          this.panel.title = `Build Details - ${title}`;
        },
        publishErrors: () => this.publishErrors(),
        isTokenCurrent: (currentToken) => this.isTokenCurrent(currentToken),
        showCompletionToast: (details) => {
          void this.showCompletionToast(details);
        },
        onPipelineLoading: (currentToken) => this.handlePipelineLoading(currentToken)
      })
    });

    const initialState: BuildDetailsInitialState = await this.pollingController.loadInitial();

    if (token !== this.loadToken) {
      return;
    }

    const consoleTextResult = initialState.consoleTextResult;
    const consoleHtmlResult = initialState.consoleHtmlResult;
    const pipelineRun = toPipelineRun(initialState.workflowRun);
    const pipelineError = initialState.workflowError
      ? `Pipeline stages: ${formatError(initialState.workflowError)}`
      : undefined;
    this.state.applyInitialState(initialState, pipelineRun, pipelineError);

    const details = this.state.currentDetails;
    const title = details?.fullDisplayName ?? details?.displayName ?? label;
    if (title) {
      this.panel.title = `Build Details - ${title}`;
    } else {
      this.panel.title = "Build Details";
    }

    const viewModel = buildBuildDetailsViewModel({
      details,
      pipelineRun: this.state.currentPipelineRun,
      pipelineLoading: this.state.pipelineLoading,
      consoleTextResult,
      consoleHtmlResult,
      errors: this.state.currentErrors,
      maxConsoleChars: MAX_CONSOLE_CHARS,
      followLog: this.state.followLog,
      pendingInputs: this.state.currentPendingInputs
    });
    const bundleSegments = BUILD_DETAILS_WEBVIEW_BUNDLE_PATH.split("/");
    const scriptUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, ...bundleSegments)
    );
    this.panel.webview.html = renderBuildDetailsHtml(viewModel, {
      cspSource: this.panel.webview.cspSource,
      nonce: this.state.currentNonce,
      scriptUri: scriptUri.toString(),
      styleUri: styleUri.toString()
    });

    if (details && !details.building && initialState.workflowError) {
      if (this.panel.visible) {
        this.pollingController.start();
      }
    }

    if (details && !details.building) {
      await this.refreshTestReport(token);
    }

    if (details?.building) {
      if (this.panel.visible) {
        this.pollingController.start();
      } else {
        this.startCompletionPolling(token);
      }
    }
  }

  private handlePanelHidden(): void {
    this.pollingController?.stop();
    this.startCompletionPolling(this.loadToken);
  }

  private async handlePanelVisible(): Promise<void> {
    this.stopCompletionPolling();
    await this.refreshBuildStatus(this.loadToken);
    if (this.state.lastDetailsBuilding) {
      this.pollingController?.start();
    } else {
      await Promise.all([
        this.refreshConsoleSnapshot(this.loadToken),
        this.refreshTestReport(this.loadToken),
        this.refreshWorkflowRun(this.loadToken),
        this.pollingController?.refreshPendingInputs()
      ]);
    }
  }

  private startCompletionPolling(token: number): void {
    if (!this.state.lastDetailsBuilding || !this.isTokenCurrent(token)) {
      return;
    }
    if (!this.dataService || !this.state.environment || !this.state.currentBuildUrl) {
      return;
    }
    this.completionPoller.start(token);
  }

  private stopCompletionPolling(): void {
    this.completionPoller.stop();
  }

  private async refreshBuildStatus(token: number): Promise<void> {
    const details = await this.fetchBuildDetails(token);
    if (!details) {
      return;
    }
    this.applyDetailsUpdate(details, true);
  }

  private async refreshWorkflowRun(token: number): Promise<void> {
    await this.pollingController?.fetchWorkflowRunWithCallbacks(token);
  }

  private async fetchBuildDetails(token: number): Promise<JenkinsBuildDetails | undefined> {
    if (!this.dataService || !this.state.environment || !this.state.currentBuildUrl) {
      return undefined;
    }
    try {
      const details = await this.dataService.getBuildDetails(
        this.state.environment,
        this.state.currentBuildUrl
      );
      if (!this.isTokenCurrent(token)) {
        return undefined;
      }
      return details;
    } catch {
      return undefined;
    }
  }

  private handlePipelineLoading(token: number): void {
    if (!this.isTokenCurrent(token)) {
      return;
    }
    const loadingChanged = this.state.setPipelineLoading(true);
    if (loadingChanged && this.panel.visible) {
      const updateMessage = buildUpdateMessageFromState(this.state);
      if (updateMessage) {
        this.postMessage(updateMessage);
      }
    }
  }

  private async refreshConsoleSnapshot(token: number): Promise<void> {
    if (!this.panel.visible) {
      return;
    }
    if (
      !this.pollingController ||
      !this.dataService ||
      !this.state.environment ||
      !this.state.currentBuildUrl
    ) {
      return;
    }
    try {
      const snapshot = await this.pollingController.refreshConsoleSnapshot();
      if (!this.isTokenCurrent(token)) {
        return;
      }
      if (snapshot.consoleHtmlResult) {
        this.postMessage({
          type: "setConsoleHtml",
          html: snapshot.consoleHtmlResult.html,
          truncated: snapshot.consoleHtmlResult.truncated
        });
        return;
      }
      if (!snapshot.consoleTextResult) {
        return;
      }
      this.postMessage({
        type: "setConsole",
        text: snapshot.consoleTextResult.text,
        truncated: snapshot.consoleTextResult.truncated
      });
    } catch {
      // Swallow failures to avoid blocking the panel resume flow.
    }
  }

  private async refreshTestReport(token: number): Promise<void> {
    if (!this.pollingController || !this.state.environment || !this.state.currentBuildUrl) {
      return;
    }
    if (this.state.currentDetails?.building) {
      return;
    }
    try {
      const testReport = await this.pollingController.fetchTestReport();
      if (!this.isTokenCurrent(token)) {
        return;
      }
      this.state.setTestReport(testReport);
      const updateMessage = buildUpdateMessageFromState(this.state);
      if (updateMessage) {
        this.postMessage(updateMessage);
      }
    } catch {
      // Swallow failures to keep the panel responsive.
    }
  }

  private applyDetailsUpdate(details: JenkinsBuildDetails, updateUi: boolean): void {
    const { wasBuilding, isBuilding } = this.state.updateDetails(details);
    if (updateUi && this.panel.visible) {
      const updateMessage = buildUpdateMessageFromState(this.state);
      if (updateMessage) {
        this.postMessage(updateMessage);
      }
      const title = details.fullDisplayName ?? details.displayName;
      if (title) {
        this.panel.title = `Build Details - ${title}`;
      }
    }
    if (wasBuilding && !isBuilding) {
      void this.showCompletionToast(details);
      void this.refreshTestReport(this.loadToken);
    }
  }

  private async showCompletionToast(details: JenkinsBuildDetails): Promise<void> {
    if (!this.state.takeCompletionToastSlot()) {
      return;
    }
    const title = details.fullDisplayName ?? details.displayName ?? "Build";
    const resultLabel = formatResult(details);
    const action = "Open in Jenkins";
    const selection = await vscode.window.showInformationMessage(
      `${title} finished with status ${resultLabel}.`,
      action
    );
    if (selection === action && this.state.currentBuildUrl) {
      await vscode.env.openExternal(vscode.Uri.parse(this.state.currentBuildUrl));
    }
  }

  private async handleApproveInput(message: { inputId: string }): Promise<void> {
    if (!this.dataService || !this.state.environment || !this.state.currentBuildUrl) {
      void vscode.window.showErrorMessage("Build details are not ready for input approval.");
      return;
    }
    const environmentId = this.state.environment.environmentId;
    const label =
      this.state.currentDetails?.fullDisplayName ??
      this.state.currentDetails?.displayName ??
      "build";
    await handlePendingInputAction({
      dataService: this.dataService,
      environment: this.state.environment,
      buildUrl: this.state.currentBuildUrl,
      label,
      inputId: message.inputId,
      action: "approve",
      onRefresh: async () => {
        await this.pollingController?.refreshPendingInputs();
        await this.refreshBuildStatus(this.loadToken);
        this.refreshHost?.refreshEnvironment(environmentId);
      }
    });
  }

  private async handleRejectInput(message: { inputId: string }): Promise<void> {
    if (!this.dataService || !this.state.environment || !this.state.currentBuildUrl) {
      void vscode.window.showErrorMessage("Build details are not ready for input rejection.");
      return;
    }
    const environmentId = this.state.environment.environmentId;
    const label =
      this.state.currentDetails?.fullDisplayName ??
      this.state.currentDetails?.displayName ??
      "build";
    await handlePendingInputAction({
      dataService: this.dataService,
      environment: this.state.environment,
      buildUrl: this.state.currentBuildUrl,
      label,
      inputId: message.inputId,
      action: "reject",
      onRefresh: async () => {
        await this.pollingController?.refreshPendingInputs();
        await this.refreshBuildStatus(this.loadToken);
        this.refreshHost?.refreshEnvironment(environmentId);
      }
    });
  }

  private async handleArtifactAction(message: {
    action: "preview" | "download";
    relativePath: string;
    fileName?: string;
  }): Promise<void> {
    if (
      !this.artifactActionHandler ||
      !this.state.environment ||
      !this.state.currentBuildUrl
    ) {
      return;
    }
    const fileName =
      typeof message.fileName === "string" && message.fileName.length > 0
        ? message.fileName
        : undefined;
    const jobNameHint =
      this.state.currentDetails?.fullDisplayName?.trim() ||
      this.state.currentDetails?.displayName?.trim() ||
      undefined;
    await this.artifactActionHandler.handle({
      action: message.action,
      environment: this.state.environment,
      buildUrl: this.state.currentBuildUrl,
      buildNumber: this.state.currentDetails?.number,
      relativePath: message.relativePath,
      fileName,
      jobNameHint
    });
  }

  private async handleExportConsole(): Promise<void> {
    if (!this.dataService || !this.state.environment || !this.state.currentBuildUrl) {
      void vscode.window.showErrorMessage("Build details are not ready to export console output.");
      return;
    }

    const defaultFileName = this.consoleExporter.getDefaultFileName(this.state.currentDetails);
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
      const result = await this.consoleExporter.exportToFile({
        environment: this.state.environment,
        buildUrl: this.state.currentBuildUrl,
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
      void vscode.window.showInformationMessage(
        `Saved console output to ${targetUri.fsPath}.`
      );
    } catch (error) {
      void vscode.window.showErrorMessage(
        `Failed to export console output: ${formatActionError(error)}`
      );
    }
  }

  private async openExternalUrl(url: string): Promise<void> {
    let parsed: vscode.Uri;
    try {
      parsed = vscode.Uri.parse(url);
    } catch {
      return;
    }
    if (parsed.scheme !== "http" && parsed.scheme !== "https") {
      return;
    }
    await vscode.env.openExternal(parsed);
  }

  private postMessage(message: BuildDetailsOutgoingMessage): void {
    void this.panel.webview.postMessage(message);
  }

  private publishErrors(): void {
    const nextErrors = this.state.updateErrors();
    if (nextErrors) {
      this.postMessage({ type: "setErrors", errors: nextErrors });
    }
  }

  private isTokenCurrent(token: number): boolean {
    return token === this.loadToken;
  }
}

function formatActionError(error: unknown): string {
  if (error instanceof BuildActionError) {
    return error.message;
  }
  return error instanceof Error ? error.message : "Unexpected error.";
}
