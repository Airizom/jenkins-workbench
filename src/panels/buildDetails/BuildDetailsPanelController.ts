import * as vscode from "vscode";
import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import { toPipelineRun } from "../../jenkins/pipeline/JenkinsPipelineAdapter";
import type { JenkinsBuildDetails } from "../../jenkins/types";
import { openExternalHttpUrlWithWarning } from "../../ui/OpenExternalUrl";
import { resolveWebviewAssets } from "../shared/webview/WebviewAssets";
import { createNonce } from "../shared/webview/WebviewNonce";
import { BuildDetailsCompletionPoller } from "./BuildDetailsCompletionPoller";
import {
  MAX_CONSOLE_CHARS,
  getBuildDetailsRefreshIntervalMs,
  getTestReportIncludeCaseLogs
} from "./BuildDetailsConfig";
import { formatError, formatResult } from "./BuildDetailsFormatters";
import type { BuildDetailsOutgoingMessage } from "./BuildDetailsMessages";
import { BuildDetailsPanelState, type PipelineRestartAvailability } from "./BuildDetailsPanelState";
import { createBuildDetailsPollingCallbacks } from "./BuildDetailsPollingCallbacks";
import {
  type BuildDetailsDataService,
  type BuildDetailsInitialState,
  BuildDetailsPollingController,
  type PendingInputActionProvider
} from "./BuildDetailsPollingController";
import { renderBuildDetailsHtml, renderLoadingHtml } from "./BuildDetailsRenderer";
import { buildUpdateMessageFromState } from "./BuildDetailsUpdateBuilder";
import { buildBuildDetailsViewModel } from "./BuildDetailsViewModel";
import { isPipelineRestartEligible } from "./PipelineRestartEligibility";

export interface BuildDetailsPanelLoadOptions {
  label?: string;
  panelState?: unknown;
}

export type BuildDetailsPanelLoadResult =
  | {
      status: "ok";
    }
  | {
      status: "missingAssets";
    };

export interface BuildDetailsPanelControllerAccess {
  getDataService(): BuildDetailsDataService | undefined;
  getEnvironment(): JenkinsEnvironmentRef | undefined;
  getBuildUrl(): string | undefined;
  getCurrentDetails(): JenkinsBuildDetails | undefined;
  getPollingController(): BuildDetailsPollingController | undefined;
  getLoadToken(): number;
  getPipelineRestartAvailability(): PipelineRestartAvailability;
  getPipelineRestartEnabled(): boolean;
  getPipelineRestartableStages(): string[];
  refreshBuildStatus(token: number): Promise<void>;
  refreshPendingInputs(): Promise<void>;
  beginLoading(): void;
  endLoading(): void;
}

export class BuildDetailsPanelController implements BuildDetailsPanelControllerAccess {
  private readonly completionPoller: BuildDetailsCompletionPoller;
  private readonly state = new BuildDetailsPanelState();
  private loadToken = 0;
  private dataService?: BuildDetailsDataService;
  private pollingController?: BuildDetailsPollingController;
  private pendingInputProvider?: PendingInputActionProvider;
  private loadingRequests = 0;

  constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly extensionUri: vscode.Uri
  ) {
    this.completionPoller = new BuildDetailsCompletionPoller({
      getRefreshIntervalMs: () => getBuildDetailsRefreshIntervalMs(),
      fetchBuildDetails: (token) => this.fetchBuildDetails(token),
      isTokenCurrent: (token) => this.isTokenCurrent(token),
      shouldPoll: () => this.state.lastDetailsBuilding,
      onDetailsUpdate: (details) => this.applyDetailsUpdate(details, false)
    });
  }

  dispose(): void {
    this.pollingController?.dispose();
    this.pollingController = undefined;
    this.stopCompletionPolling();
    this.loadingRequests = 0;
  }

  setPendingInputProvider(provider: PendingInputActionProvider | undefined): void {
    this.pendingInputProvider = provider;
  }

  updateTestReportOptions(): void {
    this.pollingController?.setTestReportOptions({
      includeCaseLogs: getTestReportIncludeCaseLogs()
    });
  }

  setFollowLog(value: boolean): void {
    this.state.setFollowLog(value);
  }

  getDataService(): BuildDetailsDataService | undefined {
    return this.dataService;
  }

  getEnvironment(): JenkinsEnvironmentRef | undefined {
    return this.state.environment;
  }

  getBuildUrl(): string | undefined {
    return this.state.currentBuildUrl;
  }

  getCurrentDetails(): JenkinsBuildDetails | undefined {
    return this.state.currentDetails;
  }

  getPollingController(): BuildDetailsPollingController | undefined {
    return this.pollingController;
  }

  getLoadToken(): number {
    return this.loadToken;
  }

  getPipelineRestartAvailability(): PipelineRestartAvailability {
    return this.state.pipelineRestartAvailability;
  }

  getPipelineRestartEnabled(): boolean {
    return this.state.pipelineRestartEnabled;
  }

  getPipelineRestartableStages(): string[] {
    return this.state.pipelineRestartableStages;
  }

  async refreshPendingInputs(): Promise<void> {
    await this.pollingController?.refreshPendingInputs();
  }

  async load(
    dataService: BuildDetailsDataService,
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    options?: BuildDetailsPanelLoadOptions
  ): Promise<BuildDetailsPanelLoadResult> {
    const token = ++this.loadToken;
    this.pollingController?.dispose();
    this.pollingController = undefined;
    this.stopCompletionPolling();
    this.dataService = dataService;
    this.loadingRequests = 0;
    this.state.resetForLoad(environment, buildUrl, createNonce());

    let scriptUri: string;
    let styleUris: string[];
    try {
      ({ scriptUri, styleUris } = resolveWebviewAssets(
        this.panel.webview,
        this.extensionUri,
        "buildDetails"
      ));
    } catch {
      return { status: "missingAssets" };
    }

    this.panel.webview.html = renderLoadingHtml({
      cspSource: this.panel.webview.cspSource,
      nonce: this.state.currentNonce,
      styleUris,
      panelState: options?.panelState
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
      return { status: "ok" };
    }

    const consoleTextResult = initialState.consoleTextResult;
    const consoleHtmlResult = initialState.consoleHtmlResult;
    const pipelineRun = toPipelineRun(initialState.workflowRun);
    const pipelineError = initialState.workflowError
      ? `Pipeline stages: ${formatError(initialState.workflowError)}`
      : undefined;
    this.state.applyInitialState(initialState, pipelineRun, pipelineError);

    const details = this.state.currentDetails;
    const title = details?.fullDisplayName ?? details?.displayName ?? options?.label;
    if (title) {
      this.panel.title = `Build Details - ${title}`;
    } else {
      this.panel.title = "Build Details";
    }

    const viewModel = buildBuildDetailsViewModel({
      details,
      buildUrl: this.state.currentBuildUrl,
      pipelineRun: this.state.currentPipelineRun,
      pipelineLoading: this.state.pipelineLoading,
      consoleTextResult,
      consoleHtmlResult,
      errors: this.state.currentErrors,
      maxConsoleChars: MAX_CONSOLE_CHARS,
      followLog: this.state.followLog,
      pendingInputs: this.state.currentPendingInputs,
      pipelineRestartEnabled: this.state.pipelineRestartEnabled,
      pipelineRestartableStages: this.state.pipelineRestartableStages
    });
    this.panel.webview.html = renderBuildDetailsHtml(viewModel, {
      cspSource: this.panel.webview.cspSource,
      nonce: this.state.currentNonce,
      scriptUri,
      styleUris,
      panelState: options?.panelState
    });
    void this.refreshRestartFromStageInfo(token, { postUpdate: true });

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

    return { status: "ok" };
  }

  handlePanelHidden(): void {
    this.pollingController?.stop();
    this.startCompletionPolling(this.loadToken);
  }

  async handlePanelVisible(): Promise<void> {
    this.beginLoading();
    this.stopCompletionPolling();
    try {
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
        void this.refreshRestartFromStageInfo(this.loadToken, { postUpdate: true });
      }
    } finally {
      this.endLoading();
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

  async refreshBuildStatus(token: number): Promise<void> {
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
      void this.refreshRestartFromStageInfo(this.loadToken, { postUpdate: true });
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
      await this.openExternalUrl(this.state.currentBuildUrl);
    }
  }

  private async refreshRestartFromStageInfo(
    token: number,
    options?: { postUpdate?: boolean }
  ): Promise<void> {
    if (!this.isTokenCurrent(token)) {
      return;
    }
    const details = this.state.currentDetails;
    if (!isPipelineRestartEligible(details)) {
      const changed = this.state.setPipelineRestartInfo(false, [], "unknown");
      if (changed && options?.postUpdate && this.panel.visible) {
        const updateMessage = buildUpdateMessageFromState(this.state);
        if (updateMessage) {
          this.postMessage(updateMessage);
        }
      }
      return;
    }
    if (!this.dataService || !this.state.environment || !this.state.currentBuildUrl) {
      return;
    }
    try {
      const restartInfo = await this.dataService.getRestartFromStageInfo(
        this.state.environment,
        this.state.currentBuildUrl
      );
      if (!this.isTokenCurrent(token)) {
        return;
      }
      const changed = this.state.setPipelineRestartInfo(
        restartInfo.restartEnabled,
        restartInfo.restartableStages,
        restartInfo.availability
      );
      if (changed && options?.postUpdate && this.panel.visible) {
        const updateMessage = buildUpdateMessageFromState(this.state);
        if (updateMessage) {
          this.postMessage(updateMessage);
        }
      }
    } catch {
      if (!this.isTokenCurrent(token)) {
        return;
      }
      // Preserve the last known capability on transient failures.
    }
  }

  private publishErrors(): void {
    const nextErrors = this.state.updateErrors();
    if (nextErrors) {
      this.postMessage({ type: "setErrors", errors: nextErrors });
    }
  }

  beginLoading(): void {
    this.loadingRequests += 1;
    if (this.loadingRequests === 1) {
      this.postMessage({ type: "setLoading", value: true });
    }
  }

  endLoading(): void {
    if (this.loadingRequests === 0) {
      return;
    }
    this.loadingRequests -= 1;
    if (this.loadingRequests === 0) {
      this.postMessage({ type: "setLoading", value: false });
    }
  }

  private isTokenCurrent(token: number): boolean {
    return token === this.loadToken;
  }

  private async openExternalUrl(url: string): Promise<void> {
    await openExternalHttpUrlWithWarning(url, {
      targetLabel: "Jenkins URL",
      sourceLabel: "Build Details"
    });
  }

  private postMessage(message: BuildDetailsOutgoingMessage): void {
    void this.panel.webview.postMessage(message);
  }
}
