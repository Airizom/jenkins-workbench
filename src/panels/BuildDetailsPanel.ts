import * as vscode from "vscode";
import type { ArtifactActionHandler } from "../ui/ArtifactActionHandler";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import { toPipelineRun } from "../jenkins/pipeline/JenkinsPipelineAdapter";
import type { JenkinsBuildDetails } from "../jenkins/types";
import { BuildDetailsCompletionPoller } from "./buildDetails/BuildDetailsCompletionPoller";
import {
  MAX_CONSOLE_CHARS,
  getBuildDetailsRefreshIntervalMs
} from "./buildDetails/BuildDetailsConfig";
import { formatError, formatResult } from "./buildDetails/BuildDetailsFormatters";
import { createBuildDetailsPollingCallbacks } from "./buildDetails/BuildDetailsPollingCallbacks";
import {
  type BuildDetailsOutgoingMessage,
  isArtifactActionMessage,
  isOpenExternalMessage,
  isToggleFollowLogMessage
} from "./buildDetails/BuildDetailsMessages";
import {
  type BuildDetailsDataService,
  type BuildDetailsInitialState,
  BuildDetailsPollingController
} from "./buildDetails/BuildDetailsPollingController";
import { BuildDetailsPanelState } from "./buildDetails/BuildDetailsPanelState";
import { renderBuildDetailsHtml, renderLoadingHtml } from "./buildDetails/BuildDetailsRenderer";
import { buildDetailsUpdateMessage } from "./buildDetails/BuildDetailsUpdateBuilder";
import { buildBuildDetailsViewModel } from "./buildDetails/BuildDetailsViewModel";
import { createNonce } from "./buildDetails/BuildDetailsWebviewUtils";

export class BuildDetailsPanel {
  private static currentPanel: BuildDetailsPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly completionPoller: BuildDetailsCompletionPoller;
  private readonly state = new BuildDetailsPanelState();
  private loadToken = 0;
  private dataService?: BuildDetailsDataService;
  private artifactActionHandler?: ArtifactActionHandler;
  private pollingController?: BuildDetailsPollingController;

  static async show(
    dataService: BuildDetailsDataService,
    artifactActionHandler: ArtifactActionHandler,
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    label?: string
  ): Promise<void> {
    if (!BuildDetailsPanel.currentPanel) {
      const panel = vscode.window.createWebviewPanel(
        "jenkinsWorkbench.buildDetails",
        "Build Details",
        vscode.ViewColumn.Active,
        {
          enableScripts: true,
          retainContextWhenHidden: true
        }
      );
      BuildDetailsPanel.currentPanel = new BuildDetailsPanel(panel);
    }

    const activePanel = BuildDetailsPanel.currentPanel;
    activePanel.panel.reveal(undefined, true);
    await activePanel.load(dataService, artifactActionHandler, environment, buildUrl, label);
  }

  private constructor(panel: vscode.WebviewPanel) {
    this.panel = panel;
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
        if (isToggleFollowLogMessage(message)) {
          this.state.setFollowLog(Boolean(message.value));
        }
      },
      null,
      this.disposables
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

    this.panel.webview.html = renderLoadingHtml({
      cspSource: this.panel.webview.cspSource,
      nonce: this.state.currentNonce
    });

    this.pollingController = new BuildDetailsPollingController({
      dataService,
      environment,
      buildUrl,
      maxConsoleChars: MAX_CONSOLE_CHARS,
      getRefreshIntervalMs: () => getBuildDetailsRefreshIntervalMs(),
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
        }
      })
    });

    const initialState: BuildDetailsInitialState = await this.pollingController.loadInitial();

    if (token !== this.loadToken) {
      return;
    }

    const consoleTextResult = initialState.consoleTextResult;
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
      consoleTextResult,
      errors: this.state.currentErrors,
      maxConsoleChars: MAX_CONSOLE_CHARS,
      followLog: this.state.followLog
    });
    this.panel.webview.html = renderBuildDetailsHtml(viewModel, {
      cspSource: this.panel.webview.cspSource,
      nonce: this.state.currentNonce
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
        this.refreshWorkflowRun(this.loadToken)
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
    if (!this.dataService || !this.state.environment || !this.state.currentBuildUrl) {
      return;
    }
    try {
      const workflowRun = await this.dataService.getWorkflowRun(
        this.state.environment,
        this.state.currentBuildUrl
      );
      if (!this.isTokenCurrent(token)) {
        return;
      }
      this.state.setPipelineRun(toPipelineRun(workflowRun));
      this.publishErrors();
      if (this.state.currentDetails && this.panel.visible) {
        this.postMessage(
          buildDetailsUpdateMessage(
            this.state.currentDetails,
            this.state.currentTestReport,
            this.state.currentPipelineRun
          )
        );
      }
    } catch (error) {
      if (!this.isTokenCurrent(token)) {
        return;
      }
      this.state.setPipelineError(`Pipeline stages: ${formatError(error)}`);
      this.publishErrors();
    }
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

  private async refreshConsoleSnapshot(token: number): Promise<void> {
    if (!this.panel.visible) {
      return;
    }
    if (!this.dataService || !this.state.environment || !this.state.currentBuildUrl) {
      return;
    }
    try {
      const consoleText = await this.dataService.getConsoleTextTail(
        this.state.environment,
        this.state.currentBuildUrl,
        MAX_CONSOLE_CHARS
      );
      if (!this.isTokenCurrent(token)) {
        return;
      }
      this.postMessage({
        type: "setConsole",
        text: consoleText.text,
        truncated: consoleText.truncated
      });
    } catch {
      // Swallow failures to avoid blocking the panel resume flow.
    }
  }

  private async refreshTestReport(token: number): Promise<void> {
    if (!this.dataService || !this.state.environment || !this.state.currentBuildUrl) {
      return;
    }
    if (this.state.currentDetails?.building) {
      return;
    }
    try {
      const testReport = await this.dataService.getTestReport(
        this.state.environment,
        this.state.currentBuildUrl
      );
      if (!this.isTokenCurrent(token)) {
        return;
      }
      this.state.setTestReport(testReport);
      if (this.state.currentDetails) {
        this.postMessage(
          buildDetailsUpdateMessage(
            this.state.currentDetails,
            this.state.currentTestReport,
            this.state.currentPipelineRun
          )
        );
      }
    } catch {
      // Swallow failures to keep the panel responsive.
    }
  }

  private applyDetailsUpdate(details: JenkinsBuildDetails, updateUi: boolean): void {
    const { wasBuilding, isBuilding } = this.state.updateDetails(details);
    if (updateUi && this.panel.visible) {
      this.postMessage(
        buildDetailsUpdateMessage(
          details,
          this.state.currentTestReport,
          this.state.currentPipelineRun
        )
      );
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
