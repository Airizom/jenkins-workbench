import type * as vscode from "vscode";
import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import type { JenkinsBuildDetails } from "../../jenkins/types";
import type { CoverageDecorationService } from "../../services/CoverageDecorationService";
import { LoadTokenTracker, PanelLoadTracker } from "../shared/PanelRuntimeHelpers";
import { createNonce } from "../shared/webview/WebviewNonce";
import type { BuildDetailsBackend, BuildDetailsPendingInputProvider } from "./BuildDetailsBackend";
import { getTestReportIncludeCaseLogs, MAX_CONSOLE_CHARS } from "./BuildDetailsConfig";
import { BuildDetailsDiagnosticConsoleSync } from "./BuildDetailsDiagnosticConsoleSync";
import { BuildDetailsInitialActivation } from "./BuildDetailsInitialActivation";
import {
  applyBuildDetailsInitialState,
  buildInitialBuildDetailsViewModel,
  resolveInitialPanelTitle
} from "./BuildDetailsInitialState";
import {
  type BuildDetailsLoadTarget,
  createBuildDetailsPanelPollingController,
  createBuildDetailsPipelineNodeLogManager
} from "./BuildDetailsLoadCollaborators";
import type {
  BuildDetailsPanelControllerAccess,
  BuildDetailsPanelLoadOptions,
  BuildDetailsPanelLoadResult
} from "./BuildDetailsPanelControllerTypes";
import { BuildDetailsPanelRuntime } from "./BuildDetailsPanelRuntime";
import { BuildDetailsPanelState, type PipelineRestartAvailability } from "./BuildDetailsPanelState";
import { BuildDetailsPanelView } from "./BuildDetailsPanelView";
import type {
  BuildDetailsInitialState,
  BuildDetailsPollingController
} from "./BuildDetailsPollingController";
import type { BuildDetailsCanOpenTestSource } from "./BuildDetailsTestSource";
import type { PipelineNodeLogManager } from "./PipelineNodeLogManager";
import type {
  BuildDiagnosticsViewModel,
  PipelineLogTargetViewModel,
  PipelineNodeLogViewModel
} from "./shared/BuildDetailsContracts";
import type { BuildDetailsOutgoingMessage } from "./shared/BuildDetailsPanelMessages";

export type {
  BuildDetailsPanelControllerAccess,
  BuildDetailsPanelLoadOptions,
  BuildDetailsPanelLoadResult
} from "./BuildDetailsPanelControllerTypes";

type BuildDetailsResolvedAssets = Parameters<BuildDetailsPanelView["renderBuildDetails"]>[1];

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
  private initialActivation?: BuildDetailsInitialActivation;
  private readonly diagnosticConsoleSync: BuildDetailsDiagnosticConsoleSync;

  constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    coverageDecorationService: CoverageDecorationService,
    getCanOpenTestSource?: BuildDetailsCanOpenTestSource,
    private readonly onBuildDetailsChanged?: (details: JenkinsBuildDetails) => void,
    private readonly onDiagnosticConsoleTextChanged?: () => void,
    private readonly whenTestSourceAvailabilityReady?: () => Promise<void>,
    onTestReportChanged?: () => void
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
      onTestReportChanged,
      state: this.state,
      view: this.view,
      coverageDecorationService,
      getBackend: () => this.backend,
      getPollingController: () => this.pollingController,
      getCurrentToken: () => this.loadTokenTracker.current,
      isTokenCurrent: (token) => this.loadTokenTracker.isCurrent(token),
      canOpenTestSource: getCanOpenTestSource,
      onBuildDetailsChanged,
      onConsoleTextSet: (text) => this.diagnosticConsoleSync.replaceAndNotify(text)
    });
  }

  dispose(): void {
    // Invalidate the current load token first so an in-flight load() that resolves after
    // disposal treats itself as stale and does not render or start runtime work.
    this.loadTokenTracker.next();
    this.disposeLoadScopedResources();
    this.diagnosticConsoleSync.dispose();
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
  hasFailedTests(): boolean {
    return (
      (this.state.currentTestReport?.failCount ?? 0) > 0 ||
      Boolean(
        this.state.currentTestReport?.suites?.some((suite) =>
          suite.cases?.some((test) => ["FAILED", "REGRESSION", "ERROR"].includes(test.status ?? ""))
        )
      )
    );
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

    const target: BuildDetailsLoadTarget = { backend, environment, buildUrl };
    this.pipelineNodeLogManager = this.createPipelineNodeLogManager(target);
    this.pollingController = this.createPollingController(target, token);

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
    this.disposeLoadScopedResources();
    this.backend = backend;
    this.loadTracker.resetLoadingRequests();
    this.state.resetForLoad(environment, buildUrl, createNonce());
    this.diagnosticConsoleSync.reset();
    return token;
  }

  private disposeLoadScopedResources(): void {
    this.initialActivation?.dispose();
    this.initialActivation = undefined;
    this.pollingController?.dispose();
    this.pollingController = undefined;
    this.pipelineNodeLogManager?.dispose();
    this.pipelineNodeLogManager = undefined;
    this.runtime.dispose();
  }

  private createPipelineNodeLogManager(target: BuildDetailsLoadTarget): PipelineNodeLogManager {
    return createBuildDetailsPipelineNodeLogManager(target, this.state, {
      postMessage: (message) => this.view.postMessage(message),
      getActiveLog: () => this.pipelineNodeLogManager?.getActiveLog()
    });
  }

  private createPollingController(
    target: BuildDetailsLoadTarget,
    token: number
  ): BuildDetailsPollingController {
    return createBuildDetailsPanelPollingController(target, {
      state: this.state,
      token,
      view: this.view,
      runtime: this.runtime,
      diagnosticConsoleSync: this.diagnosticConsoleSync,
      pendingInputProvider: this.pendingInputProvider,
      canOpenTestSource: this.canOpenTestSource,
      isTokenCurrent: (currentToken) => this.loadTokenTracker.isCurrent(currentToken),
      publishErrors: () => this.publishErrors(),
      onBuildDetailsChanged: (details) => this.onBuildDetailsChanged?.(details)
    });
  }

  private applyInitialStateAndRender(
    initialState: BuildDetailsInitialState,
    assets: BuildDetailsResolvedAssets,
    options: BuildDetailsPanelLoadOptions | undefined,
    token: number
  ): JenkinsBuildDetails | undefined {
    applyBuildDetailsInitialState(this.state, initialState);
    this.diagnosticConsoleSync.setText(initialState.consoleTextResult?.text ?? "");
    const details = this.state.currentDetails;
    if (details) {
      this.onBuildDetailsChanged?.(details);
    }
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

  private async activateInitialRuntime(
    details: JenkinsBuildDetails | undefined,
    workflowError: unknown,
    token: number
  ): Promise<void> {
    this.initialActivation?.dispose();
    this.initialActivation = new BuildDetailsInitialActivation({
      token,
      workflowError,
      state: this.state,
      view: this.view,
      runtime: this.runtime,
      getPollingController: () => this.pollingController,
      isTokenCurrent: (currentToken) => this.loadTokenTracker.isCurrent(currentToken),
      publishErrors: () => this.publishErrors()
    });
    await this.initialActivation.activate(details);
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

  beginLoading(): number {
    return this.loadTracker.beginLoading();
  }

  endLoading(request: number): void {
    this.loadTracker.endLoading(request);
  }

  postMessage(message: BuildDetailsOutgoingMessage): void {
    this.view.postMessage(message);
  }
}
