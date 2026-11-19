import type * as vscode from "vscode";
import type { BuildRelationship } from "../../jenkins/BuildRelationships";
import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import type { JenkinsBuildDetails } from "../../jenkins/types";
import type { BuildCompletionTracker } from "../../services/buildFollow/BuildCompletionTracker";
import type { CoverageDecorationService } from "../../services/CoverageDecorationService";
import { LoadTokenTracker, PanelLoadTracker } from "../shared/PanelRuntimeHelpers";
import { createNonce } from "../shared/webview/WebviewNonce";
import type { BuildDetailsBackend, BuildDetailsPendingInputProvider } from "./BuildDetailsBackend";
import type { PanelCompletionTracker } from "./BuildDetailsCompletionCoordinator";
import { getTestReportIncludeCaseLogs, MAX_CONSOLE_CHARS } from "./BuildDetailsConfig";
import { BuildDetailsDiagnosticConsoleSync } from "./BuildDetailsDiagnosticConsoleSync";
import { formatError } from "./BuildDetailsFormatters";
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
import { BuildRelationshipsController } from "./BuildRelationshipsController";
import type { ConsoleSnapshotResult } from "./ConsoleStreamManager";
import type { PipelineNodeLogManager } from "./PipelineNodeLogManager";
import type {
  BuildDiagnosticsViewModel,
  BuildNavigationViewModel,
  PipelineLogTargetViewModel,
  PipelineNodeLogViewModel
} from "./shared/BuildDetailsContracts";
import { EMPTY_BUILD_NAVIGATION } from "./shared/BuildDetailsContracts";
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
  private readonly relationships: BuildRelationshipsController;
  private navigation: BuildNavigationViewModel = { ...EMPTY_BUILD_NAVIGATION };
  private readonly runtime: BuildDetailsPanelRuntime;
  private readonly canOpenTestSource?: BuildDetailsCanOpenTestSource;
  private readonly loadTokenTracker = new LoadTokenTracker();
  private readonly loadTracker: PanelLoadTracker;
  private backend?: BuildDetailsBackend;
  private pollingController?: BuildDetailsPollingController;
  private pipelineNodeLogManager?: PipelineNodeLogManager;
  private pendingInputProvider?: BuildDetailsPendingInputProvider;
  private initialActivation?: BuildDetailsInitialActivation;
  private embeddedConsole?: ConsoleSnapshotResult;
  private readonly readyDocuments = new Set<string>();
  private readonly diagnosticConsoleSync: BuildDetailsDiagnosticConsoleSync;
  private disposed = false;
  private hydratingVerifiedSelection = false;
  private readonly completionSubscription?: vscode.Disposable;

  constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    coverageDecorationService: CoverageDecorationService,
    getCanOpenTestSource?: BuildDetailsCanOpenTestSource,
    private readonly onBuildDetailsChanged?: (details: JenkinsBuildDetails) => void,
    private readonly onDiagnosticConsoleTextChanged?: () => void,
    private readonly whenTestSourceAvailabilityReady?: () => Promise<void>,
    onTestReportChanged?: () => void,
    completionTracker?: PanelCompletionTracker &
      Pick<BuildCompletionTracker, "onDidNotifyCompletion">
  ) {
    this.canOpenTestSource = getCanOpenTestSource;
    this.diagnosticConsoleSync = new BuildDetailsDiagnosticConsoleSync({
      maxConsoleChars: MAX_CONSOLE_CHARS,
      getBackend: () => this.backend?.console,
      getEnvironment: () => this.state.environment,
      getBuildUrl: () => this.pollingController?.consoleUrl,
      getLoadToken: () => this.loadTokenTracker.current,
      isLoadTokenCurrent: (token) => this.loadTokenTracker.isCurrent(token),
      onTextChanged: () => this.onDiagnosticConsoleTextChanged?.()
    });
    this.view = new BuildDetailsPanelView(panel, extensionUri);
    this.relationships = new BuildRelationshipsController(
      (relationships) => this.postMessage({ type: "setBuildRelationships", relationships }),
      () => this.view.isVisible()
    );
    this.loadTracker = new PanelLoadTracker((value) => this.view.setLoading(value));
    this.runtime = new BuildDetailsPanelRuntime({
      onTestReportChanged,
      completionTracker,
      state: this.state,
      view: this.view,
      coverageDecorationService,
      getBackend: () => this.backend,
      getPollingController: () => this.pollingController,
      getCurrentToken: () => this.loadTokenTracker.current,
      isTokenCurrent: (token) => this.loadTokenTracker.isCurrent(token),
      canOpenTestSource: getCanOpenTestSource,
      onBuildDetailsChanged: (details) => this.handleBuildDetailsChanged(details),
      onConsoleSnapshot: (snapshot) => this.presentConsoleSnapshot(snapshot)
    });
    this.completionSubscription = completionTracker?.onDidNotifyCompletion((build) => {
      if (build.source !== "panel") this.state.recordFollowedBuildCompletion(build);
    });
  }

  dispose(): void {
    this.disposed = true;
    this.completionSubscription?.dispose();
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
    const includeCaseLogs = getTestReportIncludeCaseLogs();
    if (
      !this.pollingController ||
      this.pollingController.resolveTestReportOptions()?.includeCaseLogs === includeCaseLogs
    )
      return;
    this.pollingController.setTestReportOptions({ includeCaseLogs });
    this.runtime.testReportOptionsChanged(this.loadTokenTracker.current);
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

  getFollowTargetToken(): number {
    return this.state.followTargetToken;
  }

  getRunningFollowTarget() {
    return this.state.getRunningFollowTarget();
  }

  getCurrentDetails(): JenkinsBuildDetails | undefined {
    return this.state.currentDetails;
  }

  getRelatedBuildTarget(targetId: string): BuildRelationship | undefined {
    return this.relationships.getTarget(targetId);
  }

  republishRelationships(): void {
    this.postMessage({
      type: "setBuildRelationships",
      relationships: this.relationships.getState()
    });
  }

  setRelatedBuildsExpanded(expanded: boolean): void {
    this.relationships.setExpanded(expanded);
  }

  async refreshRelatedBuilds(): Promise<void> {
    await this.relationships.refresh();
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

    this.hydratingVerifiedSelection = options?.verifiedSelection === true;
    const target: BuildDetailsLoadTarget = { backend, environment, buildUrl };
    this.pipelineNodeLogManager = this.createPipelineNodeLogManager(target);
    this.pollingController = this.createPollingController(target, token);

    // Wait for test-source availability (Git API initialization) alongside the initial fetch so
    // the first render does not report linked repositories as unavailable.
    if (options?.initialDetails) this.runtime.receiveBuildDetails(token, options.initialDetails);
    let initialState: BuildDetailsInitialState;
    try {
      [initialState] = await Promise.all([
        this.pollingController.loadInitial(options?.initialDetails),
        this.whenTestSourceAvailabilityReady?.() ?? Promise.resolve()
      ]);
      if (!this.loadTokenTracker.isCurrent(token)) return { status: "ok" };
      await this.applyInitialStateAndRender(initialState, assets, options, token);
    } finally {
      if (this.loadTokenTracker.isCurrent(token)) this.hydratingVerifiedSelection = false;
    }
    if (this.loadTokenTracker.isCurrent(token))
      await this.activateInitialRuntime(
        this.state.currentDetails,
        initialState.workflowError,
        token
      );

    return { status: "ok" };
  }

  private prepareLoad(
    backend: BuildDetailsBackend,
    environment: JenkinsEnvironmentRef,
    buildUrl: string
  ): number {
    const token = this.loadTokenTracker.next();
    this.hydratingVerifiedSelection = false;
    this.disposeLoadScopedResources();
    this.backend = backend;
    this.loadTracker.resetLoadingRequests();
    this.state.resetForLoad(environment, buildUrl, createNonce());
    this.diagnosticConsoleSync.reset();
    this.embeddedConsole = undefined;
    this.readyDocuments.clear();
    return token;
  }

  private disposeLoadScopedResources(): void {
    this.relationships.clear();
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
      isTokenCurrent: (currentToken) => this.loadTokenTracker.isCurrent(currentToken),
      publishErrors: () => this.publishErrors(),
      onBuildDetailsChanged: (details) => this.runtime.onBuildDetailsApplied(details)
    });
  }

  private async applyInitialStateAndRender(
    initialState: BuildDetailsInitialState,
    assets: BuildDetailsResolvedAssets,
    options: BuildDetailsPanelLoadOptions | undefined,
    token: number
  ): Promise<void> {
    // A visibility or manual refresh can finish while initial workflow or console reads are pending.
    const appliedInitial = applyBuildDetailsInitialState(this.state, initialState);
    const polling = this.pollingController;
    if (!polling) return;
    polling.selectConsoleRun(this.state.currentDetails);
    await polling.withConsoleSnapshot((snapshot) => {
      if (!this.loadTokenTracker.isCurrent(token)) return;
      const details = this.state.currentDetails;
      this.diagnosticConsoleSync.setText(snapshot.consoleTextResult?.text ?? "");
      this.updateConsoleReadError(snapshot);
      if (this.state.environment && this.state.currentBuildUrl) {
        this.relationships.initialize(
          this.state.environment,
          this.state.currentBuildUrl,
          this.backend?.relationships,
          details
        );
      }
      this.view.setTitle(resolveInitialPanelTitle(details, options?.label));
      this.view.renderBuildDetails(
        {
          ...buildInitialBuildDetailsViewModel(
            this.state,
            { errors: [], ...snapshot },
            this.canOpenTestSource
          ),
          loadToken: token,
          relationships: this.relationships.getState(),
          navigation: this.navigation
        },
        assets,
        { nonce: this.state.currentNonce, panelState: options?.panelState }
      );
      this.embeddedConsole = snapshot;
      if (
        appliedInitial &&
        initialState.details &&
        !this.state.hasNewerDisplayedDetails(initialState.details)
      )
        this.runtime.onBuildDetailsApplied(initialState.details);
    });
  }

  handleWebviewReady(token: number, documentId: string): boolean {
    const embedded = this.embeddedConsole;
    const polling = this.pollingController;
    if (
      !this.loadTokenTracker.isCurrent(token) ||
      !embedded ||
      !polling ||
      this.readyDocuments.has(documentId)
    )
      return false;

    const recreated = this.readyDocuments.size > 0;
    this.readyDocuments.add(documentId);
    const generation = this.readyDocuments.size;
    this.runtime.postStateUpdate();
    this.view.postErrors(this.state.currentErrors);
    // React starts each new document from the HTML's original model. Re-seed a
    // recreated document and its progressive cursors together, even on the same load.
    polling.setConsoleReady(false);
    void polling.withConsoleSnapshot((snapshot) => {
      if (this.readyDocuments.size !== generation) return;
      if (snapshot !== embedded || recreated) this.presentConsoleSnapshot(snapshot, true);
      polling.setConsoleReady(true);
    }, recreated);
    return true;
  }

  private updateConsoleReadError(snapshot: ConsoleSnapshotResult): void {
    this.state.setConsoleReadError(
      snapshot.consoleError ? formatError(snapshot.consoleError) : undefined
    );
    this.publishErrors();
  }

  private presentConsoleSnapshot(snapshot: ConsoleSnapshotResult, restoreDocument = false): void {
    this.updateConsoleReadError(snapshot);
    if (snapshot.consoleError) {
      if (!restoreDocument) return;
      // A same-run fallback may predate streamed bytes. Keep the latest confirmed
      // text for a recreated document and keep the cached HTML when it still matches.
      const text = this.diagnosticConsoleSync.getText();
      if (text && text !== snapshot.consoleTextResult?.text) {
        this.view.postMessage({
          type: "setConsole",
          text,
          truncated:
            Boolean(snapshot.consoleTextResult?.truncated) || text.length >= MAX_CONSOLE_CHARS
        });
        return;
      }
    }
    if (snapshot.consoleTextResult) {
      this.diagnosticConsoleSync.replaceAndNotify(snapshot.consoleTextResult.text);
      this.view.postConsoleSnapshot(snapshot);
    } else if (restoreDocument) {
      this.view.postMessage({ type: "setConsole", text: "", truncated: false });
    }
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
    if (this.hydratingVerifiedSelection) return;
    this.relationships.handleHidden();
    this.pipelineNodeLogManager?.pause();
    this.runtime.handlePanelHidden(this.loadTokenTracker.current);
  }

  async handlePanelVisible(): Promise<void> {
    if (this.hydratingVerifiedSelection) return;
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
    if (this.hydratingVerifiedSelection) return;
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

  private handleBuildDetailsChanged(details: JenkinsBuildDetails): void {
    const polling = this.pollingController;
    const consoleChange = polling?.selectConsoleRun(this.state.currentDetails);
    if (consoleChange === "replacement") {
      this.diagnosticConsoleSync.reset();
      if (polling?.canPostConsole)
        this.view.postMessage({ type: "setConsole", text: "", truncated: false });
    }
    // Before React acknowledges this load, the ready handler takes the current tail.
    // A hidden panel can refresh it on reveal.
    if (consoleChange && polling?.canPostConsole && this.view.isVisible()) {
      void polling.withConsoleSnapshot((snapshot) => {
        if (polling.canPostConsole && this.view.isVisible()) this.presentConsoleSnapshot(snapshot);
      });
    }
    this.relationships.updateUpstream(details);
    this.onBuildDetailsChanged?.(details);
  }

  beginLoading(): number {
    return this.loadTracker.beginLoading();
  }

  endLoading(request: number): void {
    this.loadTracker.endLoading(request);
  }

  postMessage(message: BuildDetailsOutgoingMessage): void {
    // Actions such as delete close the panel before their completion message is sent, and a
    // disposed webview throws on access.
    if (this.disposed) {
      return;
    }
    if (message.type === "setBuildNavigation") {
      this.navigation = message.navigation;
    }
    this.view.postMessage(message);
  }
}
