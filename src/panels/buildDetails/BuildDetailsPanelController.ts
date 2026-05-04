import type * as vscode from "vscode";
import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import { toPipelineRun } from "../../jenkins/pipeline/JenkinsPipelineAdapter";
import type { JenkinsBuildDetails } from "../../jenkins/types";
import type { CoverageDecorationService } from "../../services/CoverageDecorationService";
import { createNonce } from "../shared/webview/WebviewNonce";
import type { BuildDetailsBackend, BuildDetailsPendingInputProvider } from "./BuildDetailsBackend";
import {
  MAX_CONSOLE_CHARS,
  getBuildDetailsCoverageEnabled,
  getBuildDetailsRefreshIntervalMs,
  getTestReportIncludeCaseLogs
} from "./BuildDetailsConfig";
import { formatError } from "./BuildDetailsFormatters";
import { BuildDetailsPanelRuntime } from "./BuildDetailsPanelRuntime";
import { BuildDetailsPanelState, type PipelineRestartAvailability } from "./BuildDetailsPanelState";
import { BuildDetailsPanelView } from "./BuildDetailsPanelView";
import { createBuildDetailsPollingCallbacks } from "./BuildDetailsPollingCallbacks";
import {
  type BuildDetailsInitialState,
  BuildDetailsPollingController
} from "./BuildDetailsPollingController";
import type { BuildDetailsCanOpenTestSource } from "./BuildDetailsTestSource";
import { buildBuildDetailsViewModel } from "./BuildDetailsViewModel";
import { PipelineNodeLogManager } from "./PipelineNodeLogManager";
import type {
  PipelineLogTargetViewModel,
  PipelineNodeLogViewModel
} from "./shared/BuildDetailsContracts";

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
  getBackend(): BuildDetailsBackend | undefined;
  getEnvironment(): JenkinsEnvironmentRef | undefined;
  getBuildUrl(): string | undefined;
  getCurrentDetails(): JenkinsBuildDetails | undefined;
  getPollingController(): BuildDetailsPollingController | undefined;
  getLoadToken(): number;
  getPipelineRestartAvailability(): PipelineRestartAvailability;
  getPipelineRestartEnabled(): boolean;
  getPipelineRestartableStages(): string[];
  getCurrentPipelineNodeLog(): PipelineNodeLogViewModel | undefined;
  selectPipelineLogTarget(target: PipelineLogTargetViewModel): void;
  clearPipelineLogTarget(): void;
  refreshBuildStatus(token: number): Promise<void>;
  refreshTestReport(
    token: number,
    options?: { includeCaseLogs?: boolean; showLoading?: boolean }
  ): Promise<void>;
  refreshCoverage(token: number, options?: { showLoading?: boolean }): Promise<void>;
  refreshPendingInputs(): Promise<void>;
  beginLoading(): void;
  endLoading(): void;
}

export class BuildDetailsPanelController implements BuildDetailsPanelControllerAccess {
  private readonly state = new BuildDetailsPanelState();
  private readonly view: BuildDetailsPanelView;
  private readonly runtime: BuildDetailsPanelRuntime;
  private readonly canOpenTestSource?: BuildDetailsCanOpenTestSource;
  private loadToken = 0;
  private backend?: BuildDetailsBackend;
  private pollingController?: BuildDetailsPollingController;
  private pipelineNodeLogManager?: PipelineNodeLogManager;
  private pendingInputProvider?: BuildDetailsPendingInputProvider;
  private loadingRequests = 0;

  constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    coverageDecorationService: CoverageDecorationService,
    getCanOpenTestSource?: BuildDetailsCanOpenTestSource
  ) {
    this.canOpenTestSource = getCanOpenTestSource;
    this.view = new BuildDetailsPanelView(panel, extensionUri);
    this.runtime = new BuildDetailsPanelRuntime({
      state: this.state,
      view: this.view,
      coverageDecorationService,
      getBackend: () => this.backend,
      getPollingController: () => this.pollingController,
      getCurrentToken: () => this.loadToken,
      isTokenCurrent: (token) => this.isTokenCurrent(token),
      canOpenTestSource: getCanOpenTestSource
    });
  }

  dispose(): void {
    this.pollingController?.dispose();
    this.pollingController = undefined;
    this.pipelineNodeLogManager?.dispose();
    this.pipelineNodeLogManager = undefined;
    this.runtime.dispose();
    this.loadingRequests = 0;
  }

  setPendingInputProvider(provider: BuildDetailsPendingInputProvider | undefined): void {
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

  getBackend(): BuildDetailsBackend | undefined {
    return this.backend;
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

  getCurrentPipelineNodeLog(): PipelineNodeLogViewModel | undefined {
    return this.pipelineNodeLogManager?.getActiveLog() ?? this.state.pipelineNodeLog;
  }

  selectPipelineLogTarget(target: PipelineLogTargetViewModel): void {
    this.pipelineNodeLogManager?.selectTarget(target);
  }

  clearPipelineLogTarget(): void {
    this.pipelineNodeLogManager?.clear();
    this.state.clearPipelineNodeLog();
    this.view.postMessage({
      type: "setPipelineNodeLog",
      log: this.state.pipelineNodeLog
    });
  }

  async refreshPendingInputs(): Promise<void> {
    await this.runtime.refreshPendingInputs();
  }

  async refreshTestReport(
    token: number,
    options?: { includeCaseLogs?: boolean; showLoading?: boolean }
  ): Promise<void> {
    await this.runtime.refreshTestReport(token, options);
  }

  async refreshCoverage(token: number, options?: { showLoading?: boolean }): Promise<void> {
    await this.runtime.refreshCoverage(token, options);
  }

  async load(
    backend: BuildDetailsBackend,
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    options?: BuildDetailsPanelLoadOptions
  ): Promise<BuildDetailsPanelLoadResult> {
    const token = ++this.loadToken;
    this.pollingController?.dispose();
    this.pollingController = undefined;
    this.pipelineNodeLogManager?.dispose();
    this.pipelineNodeLogManager = undefined;
    this.runtime.dispose();
    this.backend = backend;
    this.loadingRequests = 0;
    this.state.resetForLoad(environment, buildUrl, createNonce());

    const assets = this.view.resolveAssets();
    if (!assets) {
      return { status: "missingAssets" };
    }

    this.view.renderLoading({
      nonce: this.state.currentNonce,
      styleUris: assets.styleUris,
      panelState: options?.panelState
    });

    this.pipelineNodeLogManager = new PipelineNodeLogManager({
      backend: backend.console,
      environment,
      buildUrl,
      getRefreshIntervalMs: () => getBuildDetailsRefreshIntervalMs(),
      formatError,
      callbacks: {
        onSetLog: (log) => {
          this.state.setPipelineNodeLog(log);
          this.view.postMessage({ type: "setPipelineNodeLog", log });
        },
        onAppendHtml: (targetKey, html) => {
          const activeLog = this.pipelineNodeLogManager?.getActiveLog();
          if (activeLog) {
            this.state.setPipelineNodeLog(activeLog);
          }
          this.view.postMessage({ type: "appendPipelineNodeLogHtml", targetKey, html });
        },
        onLoading: (targetKey, loading) => {
          this.view.postMessage({ type: "setPipelineNodeLogLoading", targetKey, loading });
        },
        onError: (targetKey, error) => {
          const nextLog = {
            ...this.state.pipelineNodeLog,
            loading: false,
            error
          };
          this.state.setPipelineNodeLog(nextLog);
          this.view.postMessage({ type: "setPipelineNodeLogError", targetKey, error });
        }
      }
    });

    this.pollingController = new BuildDetailsPollingController({
      statusBackend: backend.status,
      testsBackend: backend.tests,
      consoleBackend: backend.console,
      pendingInputsBackend: backend.pendingInputs,
      pendingInputProvider: this.pendingInputProvider,
      environment,
      buildUrl,
      maxConsoleChars: MAX_CONSOLE_CHARS,
      getRefreshIntervalMs: () => getBuildDetailsRefreshIntervalMs(),
      testReportOptions: { includeCaseLogs: getTestReportIncludeCaseLogs() },
      formatError,
      callbacks: createBuildDetailsPollingCallbacks(this.state, token, {
        postMessage: (message) => this.view.postMessage(message),
        setTitle: (title) => this.view.setTitle(title),
        publishErrors: () => this.publishErrors(),
        isTokenCurrent: (currentToken) => this.isTokenCurrent(currentToken),
        showCompletionToast: (details) => {
          void this.runtime.showCompletionToast(details);
        },
        handleBuildCompleted: (details, currentToken) => {
          this.runtime.handleBuildCompleted(details, currentToken);
        },
        getCoverageEnabled: () => getBuildDetailsCoverageEnabled(),
        canOpenSource: (className) =>
          this.canOpenTestSource?.(this.state.environment, this.state.currentBuildUrl, className) ??
          false,
        onPipelineLoading: (currentToken) => this.runtime.handlePipelineLoading(currentToken)
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
    this.view.setTitle(details?.fullDisplayName ?? details?.displayName ?? options?.label);

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
      pipelineRestartableStages: this.state.pipelineRestartableStages,
      pipelineNodeLog: this.state.pipelineNodeLog,
      testReportFetched: this.state.testReportFetched,
      testReportLogsIncluded: this.state.testReportLogsIncluded,
      testResultsLoading: this.state.testResultsLoading,
      coverageOverview: this.state.currentCoverageOverview,
      modifiedCoverageFiles: this.state.currentModifiedCoverageFiles,
      coverageActionPath: this.state.currentCoverageActionPath,
      coverageFetched: this.state.coverageFetched,
      coverageLoading: this.state.coverageLoading,
      coverageError: this.state.currentCoverageError,
      coverageEnabled: getBuildDetailsCoverageEnabled(),
      canOpenTestSource: (className) =>
        this.canOpenTestSource?.(this.state.environment, this.state.currentBuildUrl, className) ??
        false
    });
    this.view.renderBuildDetails(viewModel, assets, {
      nonce: this.state.currentNonce,
      panelState: options?.panelState
    });
    void this.runtime.refreshRestartFromStageInfo(token, { postUpdate: true });

    if (details && !details.building && initialState.workflowError) {
      if (this.view.isVisible()) {
        this.pollingController.start();
      }
    }

    if (details && !details.building) {
      await Promise.all([
        this.runtime.refreshTestReport(token, { showLoading: true }),
        this.runtime.refreshCoverage(token, { showLoading: true })
      ]);
    }

    if (details?.building) {
      if (this.view.isVisible()) {
        this.pollingController.start();
      } else {
        this.runtime.handlePanelHidden(token);
      }
    }

    return { status: "ok" };
  }

  handlePanelHidden(): void {
    this.pipelineNodeLogManager?.pause();
    this.runtime.handlePanelHidden(this.loadToken);
  }

  async handlePanelVisible(): Promise<void> {
    this.beginLoading();
    try {
      await this.runtime.handlePanelVisible(this.loadToken);
      this.pipelineNodeLogManager?.resume();
    } finally {
      this.endLoading();
    }
  }

  async refreshBuildStatus(token: number): Promise<void> {
    await this.runtime.refreshBuildStatus(token);
  }

  private publishErrors(): void {
    const nextErrors = this.state.updateErrors();
    if (nextErrors) {
      this.view.postErrors(nextErrors);
    }
  }

  beginLoading(): void {
    this.loadingRequests += 1;
    if (this.loadingRequests === 1) {
      this.view.setLoading(true);
    }
  }

  endLoading(): void {
    if (this.loadingRequests === 0) {
      return;
    }
    this.loadingRequests -= 1;
    if (this.loadingRequests === 0) {
      this.view.setLoading(false);
    }
  }

  private isTokenCurrent(token: number): boolean {
    return token === this.loadToken;
  }
}
