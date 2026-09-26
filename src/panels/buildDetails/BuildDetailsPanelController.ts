import type * as vscode from "vscode";
import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import type { JenkinsBuildDetails } from "../../jenkins/types";
import type { CoverageDecorationService } from "../../services/CoverageDecorationService";
import { LoadTokenTracker, PanelLoadTracker } from "../shared/PanelRuntimeHelpers";
import { createNonce } from "../shared/webview/WebviewNonce";
import type { BuildDetailsBackend, BuildDetailsPendingInputProvider } from "./BuildDetailsBackend";
import {
  getBuildDetailsCoverageEnabled,
  getBuildDetailsRefreshIntervalMs,
  getTestReportIncludeCaseLogs,
  MAX_CONSOLE_CHARS
} from "./BuildDetailsConfig";
import { BuildDetailsDiagnosticConsoleSync } from "./BuildDetailsDiagnosticConsoleSync";
import { formatError } from "./BuildDetailsFormatters";
import {
  applyBuildDetailsInitialState,
  buildInitialBuildDetailsViewModel,
  resolveInitialPanelTitle
} from "./BuildDetailsInitialState";
import { BuildDetailsPanelRuntime } from "./BuildDetailsPanelRuntime";
import { BuildDetailsPanelState, type PipelineRestartAvailability } from "./BuildDetailsPanelState";
import { BuildDetailsPanelView } from "./BuildDetailsPanelView";
import { createBuildDetailsPollingCallbacks } from "./BuildDetailsPollingCallbacks";
import {
  type BuildDetailsInitialState,
  BuildDetailsPollingController
} from "./BuildDetailsPollingController";
import type { BuildDetailsCanOpenTestSource } from "./BuildDetailsTestSource";
import type { ConsoleTextByteRange } from "./ConsoleStreamManager";
import { PipelineNodeLogManager } from "./PipelineNodeLogManager";
import type {
  BuildDiagnosticsViewModel,
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

type BuildDetailsResolvedAssets = Parameters<BuildDetailsPanelView["renderBuildDetails"]>[1];

const MAX_INITIAL_STATUS_RETRIES = 5;
const BUILD_DETAILS_ERROR_PREFIX = "Build details: ";

export interface BuildDetailsPanelControllerAccess {
  getBackend(): BuildDetailsBackend | undefined;
  getEnvironment(): JenkinsEnvironmentRef | undefined;
  getBuildUrl(): string | undefined;
  getCurrentDetails(): JenkinsBuildDetails | undefined;
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
  beginLoading(): number;
  endLoading(request: number): void;
}

export class BuildDetailsPanelController implements BuildDetailsPanelControllerAccess {
  private readonly state = new BuildDetailsPanelState();
  private readonly view: BuildDetailsPanelView;
  private readonly runtime: BuildDetailsPanelRuntime;
  private readonly canOpenTestSource?: BuildDetailsCanOpenTestSource;
  private readonly loadTokenTracker = new LoadTokenTracker();
  private readonly loadTracker: PanelLoadTracker;
  private backend?: BuildDetailsBackend;
  private pollingController?: BuildDetailsPollingController;
  private pipelineNodeLogManager?: PipelineNodeLogManager;
  private pendingInputProvider?: BuildDetailsPendingInputProvider;
  private initialStatusRetryTimer: NodeJS.Timeout | undefined;
  private readonly diagnosticConsoleSync: BuildDetailsDiagnosticConsoleSync;

  constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    coverageDecorationService: CoverageDecorationService,
    getCanOpenTestSource?: BuildDetailsCanOpenTestSource,
    private readonly onBuildDetailsChanged?: (details: JenkinsBuildDetails) => void,
    private readonly onDiagnosticConsoleTextChanged?: () => void,
    private readonly whenTestSourceAvailabilityReady?: () => Promise<void>
  ) {
    this.canOpenTestSource = getCanOpenTestSource;
    this.diagnosticConsoleSync = new BuildDetailsDiagnosticConsoleSync({
      maxConsoleChars: MAX_CONSOLE_CHARS,
      getBackend: () => this.backend?.console,
      getEnvironment: () => this.state.environment,
      getBuildUrl: () => this.state.currentBuildUrl,
      getLoadToken: () => this.loadTokenTracker.current,
      isLoadTokenCurrent: (token) => this.loadTokenTracker.isCurrent(token),
      onTextChanged: () => this.onDiagnosticConsoleTextChanged?.()
    });
    this.view = new BuildDetailsPanelView(panel, extensionUri);
    this.loadTracker = new PanelLoadTracker((value) => this.view.setLoading(value));
    this.runtime = new BuildDetailsPanelRuntime({
      state: this.state,
      view: this.view,
      coverageDecorationService,
      getBackend: () => this.backend,
      getPollingController: () => this.pollingController,
      getCurrentToken: () => this.loadTokenTracker.current,
      isTokenCurrent: (token) => this.loadTokenTracker.isCurrent(token),
      canOpenTestSource: getCanOpenTestSource,
      onBuildDetailsChanged,
      onConsoleTextSet: (text) => this.replaceDiagnosticConsoleText(text)
    });
  }

  dispose(): void {
    // Invalidate the current load token first so an in-flight load() that resolves after
    // disposal treats itself as stale and does not render or start runtime work.
    this.loadTokenTracker.next();
    this.clearInitialStatusRetry();
    this.diagnosticConsoleSync.dispose();
    this.pollingController?.dispose();
    this.pollingController = undefined;
    this.pipelineNodeLogManager?.dispose();
    this.pipelineNodeLogManager = undefined;
    this.runtime.dispose();
    this.loadTracker.resetLoadingRequests();
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

  getDiagnosticConsoleText(): string {
    return this.diagnosticConsoleSync.getText();
  }

  postBuildDiagnostics(diagnostics: BuildDiagnosticsViewModel): void {
    this.view.postMessage({ type: "setBuildDiagnostics", diagnostics });
  }

  getLoadToken(): number {
    return this.loadTokenTracker.current;
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
    const token = this.prepareLoad(backend, environment, buildUrl);

    const assets = this.view.resolveAssetsAndRenderLoading({
      nonce: this.state.currentNonce,
      panelState: options?.panelState
    });
    if (!assets) {
      return { status: "missingAssets" };
    }

    this.pipelineNodeLogManager = this.createPipelineNodeLogManager(backend, environment, buildUrl);
    this.pollingController = this.createPollingController(backend, environment, buildUrl, token);

    // Wait for test-source availability (Git API initialization) alongside the initial fetch so
    // the first render does not report linked repositories as unavailable.
    const [initialState]: [BuildDetailsInitialState, unknown] = await Promise.all([
      this.pollingController.loadInitial(),
      this.whenTestSourceAvailabilityReady?.() ?? Promise.resolve()
    ]);
    if (!this.loadTokenTracker.isCurrent(token)) {
      return { status: "ok" };
    }
    const details = this.applyInitialStateAndRender(initialState, assets, options, token);
    await this.activateInitialRuntime(details, initialState.workflowError, token);

    return { status: "ok" };
  }

  private prepareLoad(
    backend: BuildDetailsBackend,
    environment: JenkinsEnvironmentRef,
    buildUrl: string
  ): number {
    const token = this.loadTokenTracker.next();
    this.clearInitialStatusRetry();
    this.pollingController?.dispose();
    this.pollingController = undefined;
    this.pipelineNodeLogManager?.dispose();
    this.pipelineNodeLogManager = undefined;
    this.runtime.dispose();
    this.backend = backend;
    this.loadTracker.resetLoadingRequests();
    this.state.resetForLoad(environment, buildUrl, createNonce());
    this.diagnosticConsoleSync.reset();
    return token;
  }

  private createPipelineNodeLogManager(
    backend: BuildDetailsBackend,
    environment: JenkinsEnvironmentRef,
    buildUrl: string
  ): PipelineNodeLogManager {
    return new PipelineNodeLogManager({
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
          const nextLog = { ...this.state.pipelineNodeLog, loading: false, error };
          this.state.setPipelineNodeLog(nextLog);
          this.view.postMessage({ type: "setPipelineNodeLogError", targetKey, error });
        }
      }
    });
  }

  private createPollingController(
    backend: BuildDetailsBackend,
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    token: number
  ): BuildDetailsPollingController {
    return new BuildDetailsPollingController({
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
        isTokenCurrent: (currentToken) => this.loadTokenTracker.isCurrent(currentToken),
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
        onPipelineLoading: (currentToken) => this.runtime.handlePipelineLoading(currentToken),
        onBuildDetailsChanged: (nextDetails) => this.onBuildDetailsChanged?.(nextDetails),
        onConsoleTextAppend: (text) => this.appendDiagnosticConsoleText(text),
        onConsoleTextSet: (text) => this.replaceDiagnosticConsoleText(text),
        onConsoleHtmlChanged: (textRange, appendedTextRange) => {
          void this.syncDiagnosticConsoleText(textRange, appendedTextRange);
        }
      })
    });
  }

  private applyInitialStateAndRender(
    initialState: BuildDetailsInitialState,
    assets: BuildDetailsResolvedAssets,
    options: BuildDetailsPanelLoadOptions | undefined,
    token: number
  ): JenkinsBuildDetails | undefined {
    this.applyInitialPanelState(initialState);
    const details = this.state.currentDetails;
    this.notifyInitialBuildDetails(details);
    this.view.setTitle(resolveInitialPanelTitle(details, options?.label));
    this.view.renderBuildDetails(
      buildInitialBuildDetailsViewModel(this.state, initialState, this.canOpenTestSource),
      assets,
      {
        nonce: this.state.currentNonce,
        panelState: options?.panelState
      }
    );
    void this.runtime.refreshRestartFromStageInfo(token, { postUpdate: true });
    return details;
  }

  private applyInitialPanelState(initialState: BuildDetailsInitialState): void {
    applyBuildDetailsInitialState(this.state, initialState);
    this.setDiagnosticConsoleText(initialState.consoleTextResult?.text ?? "");
  }

  private notifyInitialBuildDetails(details: JenkinsBuildDetails | undefined): void {
    if (details) {
      this.onBuildDetailsChanged?.(details);
    }
  }

  private async activateInitialRuntime(
    details: JenkinsBuildDetails | undefined,
    workflowError: unknown,
    token: number
  ): Promise<void> {
    if (!details) {
      // The initial details request failed; retry a bounded number of times so a transient
      // failure does not leave the panel stuck on its initial error state.
      this.scheduleInitialStatusRetry(workflowError, token, 1);
      return;
    }
    if (details.building) {
      this.activateRunningBuild(token);
      return;
    }
    await this.activateCompletedBuild(workflowError, token);
  }

  private scheduleInitialStatusRetry(workflowError: unknown, token: number, attempt: number): void {
    if (attempt > MAX_INITIAL_STATUS_RETRIES || !this.loadTokenTracker.isCurrent(token)) {
      return;
    }
    this.clearInitialStatusRetry();
    this.initialStatusRetryTimer = setTimeout(() => {
      this.initialStatusRetryTimer = undefined;
      void this.retryInitialStatus(workflowError, token, attempt);
    }, getBuildDetailsRefreshIntervalMs());
  }

  private async retryInitialStatus(
    workflowError: unknown,
    token: number,
    attempt: number
  ): Promise<void> {
    if (!this.loadTokenTracker.isCurrent(token)) {
      return;
    }
    await this.runtime.refreshBuildStatus(token);
    if (!this.loadTokenTracker.isCurrent(token)) {
      return;
    }
    const details = this.state.currentDetails;
    if (!details) {
      this.scheduleInitialStatusRetry(workflowError, token, attempt + 1);
      return;
    }
    this.state.removeBaseErrors((error) => error.startsWith(BUILD_DETAILS_ERROR_PREFIX));
    this.publishErrors();
    await this.activateInitialRuntime(details, workflowError, token);
  }

  private clearInitialStatusRetry(): void {
    if (this.initialStatusRetryTimer) {
      clearTimeout(this.initialStatusRetryTimer);
      this.initialStatusRetryTimer = undefined;
    }
  }

  private async activateCompletedBuild(workflowError: unknown, token: number): Promise<void> {
    if (workflowError && this.view.isVisible()) {
      this.pollingController?.start();
    }
    await Promise.all([
      this.runtime.refreshTestReport(token, { showLoading: true }),
      this.runtime.refreshCoverage(token, { showLoading: true })
    ]);
  }

  private activateRunningBuild(token: number): void {
    if (this.view.isVisible()) {
      this.pollingController?.start();
      return;
    }
    this.runtime.handlePanelHidden(token);
  }

  handlePanelHidden(): void {
    this.pipelineNodeLogManager?.pause();
    this.runtime.handlePanelHidden(this.loadTokenTracker.current);
  }

  async handlePanelVisible(): Promise<void> {
    const loadingRequest = this.beginLoading();
    try {
      const stillVisible = await this.runtime.handlePanelVisible(this.loadTokenTracker.current);
      // The panel may have been hidden while the status refresh was in flight; in that case
      // handlePanelHidden already paused node logs and they must stay paused.
      if (stillVisible && this.view.isVisible()) {
        this.pipelineNodeLogManager?.resume();
      }
    } finally {
      this.endLoading(loadingRequest);
    }
  }

  async refreshBuildStatus(token: number): Promise<void> {
    await this.runtime.refreshBuildStatus(token);
  }

  async refreshBuildDetails(options?: BuildDetailsPanelLoadOptions): Promise<void> {
    const backend = this.backend;
    const environment = this.state.environment;
    const buildUrl = this.state.currentBuildUrl;
    if (!backend || !environment || !buildUrl) {
      return;
    }
    await this.load(backend, environment, buildUrl, options);
  }

  private publishErrors(): void {
    const nextErrors = this.state.updateErrors();
    if (nextErrors) {
      this.view.postErrors(nextErrors);
    }
  }

  private appendDiagnosticConsoleText(text: string): void {
    this.diagnosticConsoleSync.appendAndNotify(text);
  }

  private replaceDiagnosticConsoleText(text: string): void {
    this.diagnosticConsoleSync.replaceAndNotify(text);
  }

  private setDiagnosticConsoleText(text: string): void {
    this.diagnosticConsoleSync.setText(text);
  }

  private syncDiagnosticConsoleText(
    textRange: ConsoleTextByteRange,
    appendedTextRange?: ConsoleTextByteRange
  ): Promise<void> {
    return this.diagnosticConsoleSync.sync(textRange, appendedTextRange);
  }

  beginLoading(): number {
    return this.loadTracker.beginLoading();
  }

  endLoading(request: number): void {
    this.loadTracker.endLoading(request);
  }
}
