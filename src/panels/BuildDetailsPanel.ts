import * as vscode from "vscode";
import type { ArtifactActionHandler } from "../ui/ArtifactActionHandler";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import { type PipelineRun, toPipelineRun } from "../jenkins/pipeline/JenkinsPipelineAdapter";
import type { JenkinsBuildDetails, JenkinsTestReport } from "../jenkins/types";
import { BuildDetailsCompletionPoller } from "./buildDetails/BuildDetailsCompletionPoller";
import {
  MAX_CONSOLE_CHARS,
  getBuildDetailsRefreshIntervalMs
} from "./buildDetails/BuildDetailsConfig";
import { formatError, formatResult } from "./buildDetails/BuildDetailsFormatters";
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
import { renderBuildDetailsHtml, renderLoadingHtml } from "./buildDetails/BuildDetailsRenderer";
import { buildDetailsUpdateMessage } from "./buildDetails/BuildDetailsUpdateBuilder";
import { buildBuildDetailsViewModel } from "./buildDetails/BuildDetailsViewModel";
import { createNonce } from "./buildDetails/BuildDetailsWebviewUtils";

export class BuildDetailsPanel {
  private static currentPanel: BuildDetailsPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly completionPoller: BuildDetailsCompletionPoller;
  private loadToken = 0;
  private dataService?: BuildDetailsDataService;
  private artifactActionHandler?: ArtifactActionHandler;
  private environment?: JenkinsEnvironmentRef;
  private currentBuildUrl?: string;
  private currentDetails?: JenkinsBuildDetails;
  private currentTestReport?: JenkinsTestReport;
  private currentPipelineRun?: PipelineRun;
  private currentErrors: string[] = [];
  private baseErrors: string[] = [];
  private pipelineError?: string;
  private pollingController?: BuildDetailsPollingController;
  private followLog = true;
  private completionToastShown = false;
  private currentNonce = "";
  private lastDetailsBuilding = false;

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
      shouldPoll: () => this.lastDetailsBuilding,
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
          this.followLog = Boolean(message.value);
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
    this.environment = environment;
    this.currentBuildUrl = buildUrl;
    this.currentDetails = undefined;
    this.currentTestReport = undefined;
    this.currentPipelineRun = undefined;
    this.currentErrors = [];
    this.baseErrors = [];
    this.pipelineError = undefined;
    this.completionToastShown = false;
    this.lastDetailsBuilding = false;
    this.currentNonce = createNonce();

    this.panel.webview.html = renderLoadingHtml({
      cspSource: this.panel.webview.cspSource,
      nonce: this.currentNonce
    });

    this.pollingController = new BuildDetailsPollingController({
      dataService,
      environment,
      buildUrl,
      maxConsoleChars: MAX_CONSOLE_CHARS,
      getRefreshIntervalMs: () => getBuildDetailsRefreshIntervalMs(),
      formatError,
      callbacks: {
        onDetails: (details) => {
          if (!this.isTokenCurrent(token)) {
            return;
          }
          this.currentDetails = details;
          this.lastDetailsBuilding = Boolean(details.building);
          this.postMessage(
            buildDetailsUpdateMessage(details, this.currentTestReport, this.currentPipelineRun)
          );
        },
        onWorkflowRun: (workflowRun) => {
          if (!this.isTokenCurrent(token)) {
            return;
          }
          this.currentPipelineRun = toPipelineRun(workflowRun);
          this.pipelineError = undefined;
          this.publishErrors();
          if (this.currentDetails) {
            this.postMessage(
              buildDetailsUpdateMessage(
                this.currentDetails,
                this.currentTestReport,
                this.currentPipelineRun
              )
            );
          }
        },
        onWorkflowError: (error) => {
          if (!this.isTokenCurrent(token)) {
            return;
          }
          this.pipelineError = `Pipeline stages: ${formatError(error)}`;
          this.publishErrors();
        },
        onTitle: (title) => {
          if (!this.isTokenCurrent(token)) {
            return;
          }
          this.panel.title = `Build Details - ${title}`;
        },
        onConsoleAppend: (text) => {
          if (!this.isTokenCurrent(token)) {
            return;
          }
          this.postMessage({ type: "appendConsole", text });
        },
        onConsoleSet: (payload) => {
          if (!this.isTokenCurrent(token)) {
            return;
          }
          this.postMessage({
            type: "setConsole",
            text: payload.text,
            truncated: payload.truncated
          });
        },
        onErrors: (errors) => {
          if (!this.isTokenCurrent(token)) {
            return;
          }
          this.baseErrors = errors;
          this.publishErrors();
        },
        onComplete: (details) => {
          if (!this.isTokenCurrent(token)) {
            return;
          }
          void this.showCompletionToast(details);
        }
      }
    });

    const initialState: BuildDetailsInitialState = await this.pollingController.loadInitial();

    if (token !== this.loadToken) {
      return;
    }

    const details = initialState.details;
    const consoleTextResult = initialState.consoleTextResult;
    const pipelineRun = toPipelineRun(initialState.workflowRun);
    const errors = initialState.errors;
    const pipelineError = initialState.workflowError
      ? `Pipeline stages: ${formatError(initialState.workflowError)}`
      : undefined;
    this.lastDetailsBuilding = details?.building ?? false;
    this.currentDetails = details;
    this.currentTestReport = undefined;
    this.currentPipelineRun = pipelineRun;
    this.baseErrors = errors;
    this.pipelineError = pipelineError;
    this.currentErrors = composeErrors(errors, pipelineError);

    const title = details?.fullDisplayName ?? details?.displayName ?? label;
    if (title) {
      this.panel.title = `Build Details - ${title}`;
    } else {
      this.panel.title = "Build Details";
    }

    const viewModel = buildBuildDetailsViewModel({
      details,
      pipelineRun,
      consoleTextResult,
      errors: this.currentErrors,
      maxConsoleChars: MAX_CONSOLE_CHARS,
      followLog: this.followLog
    });
    this.panel.webview.html = renderBuildDetailsHtml(viewModel, {
      cspSource: this.panel.webview.cspSource,
      nonce: this.currentNonce
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
    if (this.lastDetailsBuilding) {
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
    if (!this.lastDetailsBuilding || !this.isTokenCurrent(token)) {
      return;
    }
    if (!this.dataService || !this.environment || !this.currentBuildUrl) {
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
    if (!this.dataService || !this.environment || !this.currentBuildUrl) {
      return;
    }
    try {
      const workflowRun = await this.dataService.getWorkflowRun(
        this.environment,
        this.currentBuildUrl
      );
      if (!this.isTokenCurrent(token)) {
        return;
      }
      this.currentPipelineRun = toPipelineRun(workflowRun);
      this.pipelineError = undefined;
      this.publishErrors();
      if (this.currentDetails && this.panel.visible) {
        this.postMessage(
          buildDetailsUpdateMessage(
            this.currentDetails,
            this.currentTestReport,
            this.currentPipelineRun
          )
        );
      }
    } catch (error) {
      if (!this.isTokenCurrent(token)) {
        return;
      }
      this.pipelineError = `Pipeline stages: ${formatError(error)}`;
      this.publishErrors();
    }
  }

  private async fetchBuildDetails(token: number): Promise<JenkinsBuildDetails | undefined> {
    if (!this.dataService || !this.environment || !this.currentBuildUrl) {
      return undefined;
    }
    try {
      const details = await this.dataService.getBuildDetails(
        this.environment,
        this.currentBuildUrl
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
    if (!this.dataService || !this.environment || !this.currentBuildUrl) {
      return;
    }
    try {
      const consoleText = await this.dataService.getConsoleTextTail(
        this.environment,
        this.currentBuildUrl,
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
    if (!this.dataService || !this.environment || !this.currentBuildUrl) {
      return;
    }
    if (this.currentDetails?.building) {
      return;
    }
    try {
      const testReport = await this.dataService.getTestReport(
        this.environment,
        this.currentBuildUrl
      );
      if (!this.isTokenCurrent(token)) {
        return;
      }
      this.currentTestReport = testReport;
      if (this.currentDetails) {
        this.postMessage(
          buildDetailsUpdateMessage(
            this.currentDetails,
            this.currentTestReport,
            this.currentPipelineRun
          )
        );
      }
    } catch {
      // Swallow failures to keep the panel responsive.
    }
  }

  private applyDetailsUpdate(details: JenkinsBuildDetails, updateUi: boolean): void {
    const wasBuilding = this.lastDetailsBuilding;
    const isBuilding = Boolean(details.building);
    this.lastDetailsBuilding = isBuilding;
    this.currentDetails = details;
    if (updateUi && this.panel.visible) {
      this.postMessage(
        buildDetailsUpdateMessage(details, this.currentTestReport, this.currentPipelineRun)
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
    if (this.completionToastShown) {
      return;
    }
    this.completionToastShown = true;
    const title = details.fullDisplayName ?? details.displayName ?? "Build";
    const resultLabel = formatResult(details);
    const action = "Open in Jenkins";
    const selection = await vscode.window.showInformationMessage(
      `${title} finished with status ${resultLabel}.`,
      action
    );
    if (selection === action && this.currentBuildUrl) {
      await vscode.env.openExternal(vscode.Uri.parse(this.currentBuildUrl));
    }
  }

  private async handleArtifactAction(message: {
    action: "preview" | "download";
    relativePath: string;
    fileName?: string;
  }): Promise<void> {
    if (!this.artifactActionHandler || !this.environment || !this.currentBuildUrl) {
      return;
    }
    const fileName =
      typeof message.fileName === "string" && message.fileName.length > 0
        ? message.fileName
        : undefined;
    const jobNameHint =
      this.currentDetails?.fullDisplayName?.trim() ||
      this.currentDetails?.displayName?.trim() ||
      undefined;
    await this.artifactActionHandler.handle({
      action: message.action,
      environment: this.environment,
      buildUrl: this.currentBuildUrl,
      buildNumber: this.currentDetails?.number,
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
    const nextErrors = composeErrors(this.baseErrors, this.pipelineError);
    if (!areErrorsEqual(nextErrors, this.currentErrors)) {
      this.currentErrors = nextErrors;
      this.postMessage({ type: "setErrors", errors: nextErrors });
    }
  }

  private isTokenCurrent(token: number): boolean {
    return token === this.loadToken;
  }
}

function areErrorsEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}

function composeErrors(baseErrors: string[], pipelineError?: string): string[] {
  const nextErrors = [...baseErrors];
  if (pipelineError && !nextErrors.includes(pipelineError)) {
    nextErrors.push(pipelineError);
  }
  return nextErrors;
}
