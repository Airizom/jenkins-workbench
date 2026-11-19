import * as vscode from "vscode";
import type { JenkinsBuildDetails } from "../../jenkins/types";
import type { CoverageDecorationService } from "../../services/CoverageDecorationService";
import { formatBuildResultLabel } from "../../shared/build/BuildHeaderLabels";
import { openExternalHttpUrlWithWarning } from "../../ui/OpenExternalUrl";
import type { BuildDetailsBackend } from "./BuildDetailsBackend";
import {
  BuildDetailsCompletionCoordinator,
  type PanelCompletionTracker
} from "./BuildDetailsCompletionCoordinator";
import { BuildDetailsCompletionPoller } from "./BuildDetailsCompletionPoller";
import {
  getBuildDetailsCoverageEnabled,
  getBuildDetailsRefreshIntervalMs
} from "./BuildDetailsConfig";
import { BuildDetailsCoverageCoordinator } from "./BuildDetailsCoverageCoordinator";
import { BuildDetailsCoverageDecorationsAdapter } from "./BuildDetailsCoverageDecorationsAdapter";
import { type BuildDetailsPanelState, getPanelBuildRequestOrder } from "./BuildDetailsPanelState";
import type { BuildDetailsPanelView } from "./BuildDetailsPanelView";
import type { BuildDetailsPollingController } from "./BuildDetailsPollingController";
import type { PanelRunTarget } from "./BuildDetailsRunIdentity";
import type { BuildDetailsCanOpenTestSource } from "./BuildDetailsTestSource";
import type { ConsoleSnapshotResult } from "./ConsoleStreamManager";
import { isPipelineRestartEligible } from "./PipelineRestartEligibility";

interface BuildDetailsPanelRuntimeOptions {
  onTestReportChanged?: () => void;
  completionTracker?: PanelCompletionTracker;
  state: BuildDetailsPanelState;
  view: BuildDetailsPanelView;
  coverageDecorationService: CoverageDecorationService;
  getBackend: () => BuildDetailsBackend | undefined;
  getPollingController: () => BuildDetailsPollingController | undefined;
  getCurrentToken: () => number;
  isTokenCurrent: (token: number) => boolean;
  canOpenTestSource?: BuildDetailsCanOpenTestSource;
  onBuildDetailsChanged?: (details: JenkinsBuildDetails) => void;
  onConsoleSnapshot?: (snapshot: ConsoleSnapshotResult) => void;
}

export class BuildDetailsPanelRuntime {
  private readonly completion: BuildDetailsCompletionCoordinator;
  private readonly completionPoller: BuildDetailsCompletionPoller;
  private readonly coverageCoordinator: BuildDetailsCoverageCoordinator;
  private testReportRefreshGeneration = 0;
  private visibilityGeneration = 0;
  private latestRunOrder = 0;
  private terminalReports?: {
    run: PanelRunTarget;
    tests?: Promise<void>;
    coverage?: Promise<void>;
  };

  constructor(private readonly options: BuildDetailsPanelRuntimeOptions) {
    this.completion = new BuildDetailsCompletionCoordinator(
      options.state,
      options.completionTracker,
      (details, url) => this.presentCompletionToast(details, url)
    );
    this.completionPoller = new BuildDetailsCompletionPoller({
      getRefreshIntervalMs: () => getBuildDetailsRefreshIntervalMs(),
      fetchBuildDetails: (token) => this.fetchBuildDetails(token),
      isTokenCurrent: (token) => this.options.isTokenCurrent(token),
      shouldPoll: () => this.options.state.needsStatusPolling,
      onDetailsUpdate: (details) => this.applyDetailsUpdate(details, false)
    });
    this.coverageCoordinator = new BuildDetailsCoverageCoordinator({
      state: this.options.state,
      decorationsAdapter: new BuildDetailsCoverageDecorationsAdapter(
        this.options.coverageDecorationService
      ),
      getCoverageBackend: () => this.options.getBackend()?.coverage,
      isTokenCurrent: this.options.isTokenCurrent,
      isViewVisible: () => this.options.view.isVisible(),
      postStateUpdate: () => this.postStateUpdate()
    });
  }

  dispose(): void {
    this.visibilityGeneration += 1;
    this.latestRunOrder = 0;
    this.terminalReports = undefined;
    this.testReportRefreshGeneration += 1;
    this.stopCompletionPolling();
    this.coverageCoordinator.dispose();
  }

  handlePanelHidden(token: number): void {
    // Invalidate any in-flight handlePanelVisible so it cannot restart visible polling after
    // the panel has already been hidden.
    this.visibilityGeneration += 1;
    this.coverageCoordinator.handlePanelHidden();
    this.options.getPollingController()?.stop();
    this.startCompletionPolling(token);
  }

  /**
   * Returns false when the panel was hidden, reloaded, or a newer visibility transition
   * started while this handler was awaiting, so it cannot start further visible-only work.
   */
  async handlePanelVisible(token: number): Promise<boolean> {
    const generation = ++this.visibilityGeneration;
    this.coverageCoordinator.handlePanelVisible();
    this.stopCompletionPolling();
    const change = await this.readAndApplyBuildStatus(token);
    if (!this.isVisibilityCurrent(token, generation)) {
      return false;
    }
    if (this.options.state.needsStatusPolling) {
      this.options.getPollingController()?.start();
      if (change?.targetChanged) void this.refreshWorkflowRun();
      return true;
    }
    await Promise.all([
      this.refreshConsoleSnapshot(token),
      this.loadTerminalReports(token),
      this.refreshWorkflowRun(),
      this.options.getPollingController()?.refreshPendingInputs()
    ]);
    if (!this.isVisibilityCurrent(token, generation)) {
      return false;
    }
    void this.refreshRestartFromStageInfo(token, { postUpdate: true });
    return true;
  }

  private isVisibilityCurrent(token: number, generation: number): boolean {
    return (
      this.options.isTokenCurrent(token) &&
      generation === this.visibilityGeneration &&
      this.options.view.isVisible()
    );
  }

  async refreshPendingInputs(): Promise<void> {
    await this.options.getPollingController()?.refreshPendingInputs();
  }

  async refreshBuildStatus(token: number): Promise<void> {
    const change = await this.readAndApplyBuildStatus(token);
    if (
      (change?.firstTerminal || change?.targetChanged) &&
      this.options.isTokenCurrent(token) &&
      this.options.view.isVisible()
    ) {
      await this.refreshWorkflowRun();
    }
  }

  private async readAndApplyBuildStatus(token: number) {
    const details = await this.fetchBuildDetails(token);
    return details && this.applyDetailsUpdate(details, true);
  }

  /** Deliver the Run before console, workflow or UI work can delay a queue handoff. */
  receiveBuildDetails(token: number, details: JenkinsBuildDetails): void {
    if (!this.options.isTokenCurrent(token)) return;
    const order = getPanelBuildRequestOrder(details);
    const superseded =
      this.options.state.hasNewerDisplayedDetails(details) ||
      (order !== undefined && order < this.latestRunOrder);
    if (order !== undefined) this.latestRunOrder = Math.max(this.latestRunOrder, order);
    this.completion.observeDetails(details, superseded);
  }

  async readBuildDetails(
    token: number,
    read: () => Promise<JenkinsBuildDetails>
  ): Promise<JenkinsBuildDetails> {
    const details = await this.options.state.readBuildDetails(read);
    this.receiveBuildDetails(token, details);
    return details;
  }

  onBuildDetailsApplied(details: JenkinsBuildDetails): void {
    this.options.onBuildDetailsChanged?.(details);
    const terminal = this.options.state.terminalRun;
    if (this.terminalReports && this.terminalReports.run !== terminal) {
      this.terminalReports = undefined;
      this.coverageCoordinator.clearRunDecorations();
    }
    if (terminal && !this.terminalReports) {
      const token = this.options.getCurrentToken();
      void this.loadTerminalReports(token);
      void this.refreshRestartFromStageInfo(token, { postUpdate: true });
    }
  }

  /** Initial activation, status polling and visibility changes share one automatic report load. */
  loadTerminalReports(token: number): Promise<void> {
    const run = this.options.state.terminalRun;
    if (!run || !this.options.isTokenCurrent(token)) return Promise.resolve();
    if (this.terminalReports?.run !== run) this.terminalReports = { run };
    const reports = this.terminalReports;
    reports.tests ??= this.loadConfiguredTestReport(token);
    reports.coverage ??= this.refreshCoverage(token, { showLoading: true });
    return Promise.all([reports.tests, reports.coverage]).then(() => undefined);
  }

  testReportOptionsChanged(token: number): void {
    if (!this.options.isTokenCurrent(token)) return;
    this.testReportRefreshGeneration++;
    const reports = this.terminalReports;
    if (!reports || reports.run !== this.options.state.terminalRun) return;
    reports.tests = this.options.view.isVisible()
      ? this.loadConfiguredTestReport(token)
      : undefined;
  }

  private loadConfiguredTestReport(token: number): Promise<void> {
    return this.refreshTestReport(token, {
      includeCaseLogs:
        this.options.getPollingController()?.resolveTestReportOptions()?.includeCaseLogs ?? false,
      showLoading: true
    });
  }

  async refreshWorkflowRun(): Promise<void> {
    const token = this.options.getCurrentToken();
    const generation = this.visibilityGeneration;
    await this.options
      .getPollingController()
      ?.fetchWorkflowRunWithCallbacks(() => this.isVisibilityCurrent(token, generation));
  }

  // fallow-ignore-next-line unused-class-member -- invoked through the polling controller pipeline callbacks
  handlePipelineLoading(token: number): void {
    if (!this.options.isTokenCurrent(token)) {
      return;
    }
    const loadingChanged = this.options.state.setPipelineLoading(true);
    if (loadingChanged && this.options.view.isVisible()) {
      this.postStateUpdate();
    }
  }

  async refreshConsoleSnapshot(token: number): Promise<void> {
    if (!this.options.isTokenCurrent(token) || !this.options.view.isVisible()) {
      return;
    }
    const pollingController = this.options.getPollingController();
    if (
      !pollingController ||
      !this.options.state.environment ||
      !this.options.state.currentBuildUrl
    ) {
      return;
    }
    try {
      await pollingController.refreshConsoleSnapshot((snapshot) => {
        if (!this.options.isTokenCurrent(token)) return;
        this.options.onConsoleSnapshot?.(snapshot);
      });
    } catch {
      return;
    }
  }

  async refreshTestReport(
    token: number,
    options?: { includeCaseLogs?: boolean; showLoading?: boolean }
  ): Promise<void> {
    if (!this.options.isTokenCurrent(token)) {
      return;
    }
    const pollingController = this.options.getPollingController();
    const run = this.options.state.terminalRun;
    if (!pollingController || !run) return;
    if (
      typeof options?.includeCaseLogs === "undefined" &&
      this.options.state.testReportLogsIncluded &&
      this.options.state.currentTestReport
    ) {
      return;
    }
    const refreshGeneration = ++this.testReportRefreshGeneration;
    if (options?.showLoading) {
      const changed = this.options.state.setTestResultsLoading(true);
      if (changed && this.options.view.isVisible()) {
        this.postStateUpdate();
      }
    }
    try {
      const fetchOptions =
        typeof options?.includeCaseLogs === "boolean"
          ? { includeCaseLogs: options.includeCaseLogs }
          : undefined;
      const { report: testReport, effectiveOptions } = await pollingController.fetchTestReport(
        run.buildUrl,
        fetchOptions
      );
      if (this.isTestReportRefreshStale(token, refreshGeneration, run)) {
        return;
      }
      this.options.state.setTestReport(testReport, {
        logsIncluded: Boolean(effectiveOptions?.includeCaseLogs)
      });
      this.options.state.setTestResultsLoading(false);
      this.options.onTestReportChanged?.();
      this.postStateUpdate();
    } catch {
      if (!this.isTestReportRefreshStale(token, refreshGeneration, run)) {
        this.options.state.markTestReportFetchAttempted();
        // A later visibility change can retry a failed request without refetching coverage.
        if (this.terminalReports) this.terminalReports.tests = undefined;
        // Always clear the shared loading flag for the current generation: an earlier
        // showLoading refresh may have set it and then been superseded by this request.
        this.options.state.setTestResultsLoading(false);
        if (this.options.view.isVisible()) {
          this.postStateUpdate();
        }
      }
      return;
    }
  }

  private isTestReportRefreshStale(
    token: number,
    refreshGeneration: number,
    run: PanelRunTarget
  ): boolean {
    return (
      !this.options.isTokenCurrent(token) ||
      refreshGeneration !== this.testReportRefreshGeneration ||
      this.options.state.terminalRun !== run
    );
  }

  refreshCoverage(token: number, options?: { showLoading?: boolean }): Promise<void> {
    if (!this.options.isTokenCurrent(token)) return Promise.resolve();
    const reports = this.terminalReports;
    const request = this.coverageCoordinator.refresh(token, options).then((complete) => {
      if (!complete && reports?.coverage === request) reports.coverage = undefined;
    });
    if (reports && reports.run === this.options.state.terminalRun) reports.coverage = request;
    return request;
  }

  async refreshRestartFromStageInfo(
    token: number,
    options?: { postUpdate?: boolean }
  ): Promise<void> {
    if (!this.options.isTokenCurrent(token)) {
      return;
    }
    const details = this.options.state.currentDetails;
    if (!isPipelineRestartEligible(details)) {
      const changed = this.options.state.setPipelineRestartInfo(false, [], "unknown");
      if (changed && options?.postUpdate && this.options.view.isVisible()) {
        this.postStateUpdate();
      }
      return;
    }

    const restartBackend = this.options.getBackend()?.restart;
    const run = this.options.state.terminalRun;
    if (!restartBackend || !this.options.state.environment || !run) return;

    try {
      const restartInfo = await restartBackend.getRestartFromStageInfo(
        this.options.state.environment,
        run.buildUrl
      );
      if (!this.options.isTokenCurrent(token) || this.options.state.terminalRun !== run) return;
      const changed = this.options.state.setPipelineRestartInfo(
        restartInfo.restartEnabled,
        restartInfo.restartableStages,
        restartInfo.availability
      );
      if (changed && options?.postUpdate && this.options.view.isVisible()) {
        this.postStateUpdate();
      }
    } catch {
      return;
    }
  }

  async showCompletionToast(details: JenkinsBuildDetails): Promise<void> {
    await this.completion.reportCompletion(details);
  }

  private async presentCompletionToast(
    details: JenkinsBuildDetails,
    buildUrl: string | undefined
  ): Promise<void> {
    const title = details.fullDisplayName ?? details.displayName ?? "Build";
    const resultLabel = formatBuildResultLabel(details);
    const action = "Open in Jenkins";
    const message = `${title} finished with status ${resultLabel}.`;
    if (!buildUrl) {
      await vscode.window.showInformationMessage(message);
      return;
    }
    const selection = await vscode.window.showInformationMessage(message, action);
    if (selection !== action) {
      return;
    }
    await openExternalHttpUrlWithWarning(buildUrl, {
      targetLabel: "Jenkins URL",
      sourceLabel: "Build Details"
    });
  }

  handleBuildCompleted(details: JenkinsBuildDetails, token: number): void {
    if (this.options.isTokenCurrent(token)) void this.showCompletionToast(details);
  }

  private startCompletionPolling(token: number): void {
    if (!this.options.state.needsStatusPolling || !this.options.isTokenCurrent(token)) {
      return;
    }
    if (!this.options.getBackend()?.status || !this.options.state.environment) {
      return;
    }
    if (!this.options.state.currentBuildUrl) {
      return;
    }
    this.completionPoller.start(token);
  }

  private stopCompletionPolling(): void {
    this.completionPoller.stop();
  }

  private async fetchBuildDetails(token: number): Promise<JenkinsBuildDetails | undefined> {
    const statusBackend = this.options.getBackend()?.status;
    const { environment, currentBuildUrl, currentDetails } = this.options.state;
    if (!statusBackend || !environment || !currentBuildUrl) {
      return undefined;
    }
    try {
      const details = await this.readBuildDetails(token, () =>
        statusBackend.getBuildDetails(
          environment,
          currentBuildUrl,
          currentDetails ? undefined : { includeCauses: true }
        )
      );
      if (!this.options.isTokenCurrent(token)) {
        return undefined;
      }
      return details;
    } catch {
      return undefined;
    }
  }

  private applyDetailsUpdate(details: JenkinsBuildDetails, updateUi: boolean) {
    const change = this.options.state.updateDetails(details);
    if (change.superseded) return change;
    this.onBuildDetailsApplied(details);
    if (updateUi && this.options.view.isVisible()) {
      this.postStateUpdate();
      this.options.view.setTitle(details.fullDisplayName ?? details.displayName);
    }
    if (change.completedNow) {
      this.handleBuildCompleted(details, this.options.getCurrentToken());
    }
    return change;
  }

  postStateUpdate(): void {
    this.options.view.postStateUpdate(this.options.state, {
      coverageEnabled: getBuildDetailsCoverageEnabled(),
      canOpenSource: (className) =>
        this.options.canOpenTestSource?.(
          this.options.state.environment,
          this.options.state.currentBuildUrl,
          className
        ) ?? false
    });
  }
}
