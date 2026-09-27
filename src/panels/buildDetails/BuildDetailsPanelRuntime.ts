import * as vscode from "vscode";
import type { JenkinsBuildDetails } from "../../jenkins/types";
import type { CoverageDecorationService } from "../../services/CoverageDecorationService";
import { formatBuildResultLabel } from "../../shared/build/BuildHeaderLabels";
import { openExternalHttpUrlWithWarning } from "../../ui/OpenExternalUrl";
import type { BuildDetailsBackend } from "./BuildDetailsBackend";
import { BuildDetailsCompletionPoller } from "./BuildDetailsCompletionPoller";
import {
  getBuildDetailsCoverageEnabled,
  getBuildDetailsRefreshIntervalMs
} from "./BuildDetailsConfig";
import { BuildDetailsCoverageCoordinator } from "./BuildDetailsCoverageCoordinator";
import { BuildDetailsCoverageDecorationsAdapter } from "./BuildDetailsCoverageDecorationsAdapter";
import type { BuildDetailsPanelState } from "./BuildDetailsPanelState";
import type { BuildDetailsPanelView } from "./BuildDetailsPanelView";
import type { BuildDetailsPollingController } from "./BuildDetailsPollingController";
import type { BuildDetailsCanOpenTestSource } from "./BuildDetailsTestSource";
import { isPipelineRestartEligible } from "./PipelineRestartEligibility";

interface BuildDetailsPanelRuntimeOptions {
  onTestReportChanged?: () => void;
  state: BuildDetailsPanelState;
  view: BuildDetailsPanelView;
  coverageDecorationService: CoverageDecorationService;
  getBackend: () => BuildDetailsBackend | undefined;
  getPollingController: () => BuildDetailsPollingController | undefined;
  getCurrentToken: () => number;
  isTokenCurrent: (token: number) => boolean;
  canOpenTestSource?: BuildDetailsCanOpenTestSource;
  onBuildDetailsChanged?: (details: JenkinsBuildDetails) => void;
  onConsoleTextSet?: (text: string) => void;
}

export class BuildDetailsPanelRuntime {
  private readonly completionPoller: BuildDetailsCompletionPoller;
  private readonly coverageCoordinator: BuildDetailsCoverageCoordinator;
  private testReportRefreshGeneration = 0;
  private visibilityGeneration = 0;

  constructor(private readonly options: BuildDetailsPanelRuntimeOptions) {
    this.completionPoller = new BuildDetailsCompletionPoller({
      getRefreshIntervalMs: () => getBuildDetailsRefreshIntervalMs(),
      fetchBuildDetails: (token) => this.fetchBuildDetails(token),
      isTokenCurrent: (token) => this.options.isTokenCurrent(token),
      shouldPoll: () => this.options.state.lastDetailsBuilding,
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
   * Returns false when the panel was hidden (or a newer visibility transition started) while
   * this handler was awaiting, in which case no visible-only work was started.
   */
  async handlePanelVisible(token: number): Promise<boolean> {
    const generation = ++this.visibilityGeneration;
    this.coverageCoordinator.handlePanelVisible();
    this.stopCompletionPolling();
    await this.refreshBuildStatus(token);
    if (!this.isVisibilityCurrent(generation)) {
      return false;
    }
    if (this.options.state.lastDetailsBuilding) {
      this.options.getPollingController()?.start();
      return true;
    }
    await Promise.all([
      this.refreshConsoleSnapshot(token),
      this.refreshTestReport(token, { showLoading: true }),
      this.refreshCoverage(token, { showLoading: true }),
      this.refreshWorkflowRun(),
      this.options.getPollingController()?.refreshPendingInputs()
    ]);
    if (!this.isVisibilityCurrent(generation)) {
      return false;
    }
    void this.refreshRestartFromStageInfo(token, { postUpdate: true });
    return true;
  }

  private isVisibilityCurrent(generation: number): boolean {
    return generation === this.visibilityGeneration && this.options.view.isVisible();
  }

  async refreshPendingInputs(): Promise<void> {
    await this.options.getPollingController()?.refreshPendingInputs();
  }

  async refreshBuildStatus(token: number): Promise<void> {
    const details = await this.fetchBuildDetails(token);
    if (!details) {
      return;
    }
    this.applyDetailsUpdate(details, true);
  }

  async refreshWorkflowRun(): Promise<void> {
    await this.options.getPollingController()?.fetchWorkflowRunWithCallbacks();
  }

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
    if (!this.options.view.isVisible()) {
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
      const snapshot = await pollingController.refreshConsoleSnapshot();
      if (!this.options.isTokenCurrent(token)) {
        return;
      }
      if (snapshot.consoleTextResult) {
        this.options.onConsoleTextSet?.(snapshot.consoleTextResult.text);
      }
      this.options.view.postConsoleSnapshot(snapshot);
    } catch {
      return;
    }
  }

  async refreshTestReport(
    token: number,
    options?: { includeCaseLogs?: boolean; showLoading?: boolean }
  ): Promise<void> {
    const pollingController = this.options.getPollingController();
    if (
      !pollingController ||
      !this.options.state.environment ||
      !this.options.state.currentBuildUrl
    ) {
      return;
    }
    if (this.options.state.currentDetails?.building) {
      return;
    }
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
      const { report: testReport, effectiveOptions } =
        await pollingController.fetchTestReport(fetchOptions);
      if (this.isTestReportRefreshStale(token, refreshGeneration)) {
        return;
      }
      this.options.state.setTestReport(testReport, {
        logsIncluded: Boolean(effectiveOptions?.includeCaseLogs)
      });
      this.options.state.setTestResultsLoading(false);
      this.options.onTestReportChanged?.();
      this.postStateUpdate();
    } catch {
      if (!this.isTestReportRefreshStale(token, refreshGeneration)) {
        this.options.state.markTestReportFetchAttempted();
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

  private isTestReportRefreshStale(token: number, refreshGeneration: number): boolean {
    return (
      !this.options.isTokenCurrent(token) || refreshGeneration !== this.testReportRefreshGeneration
    );
  }

  async refreshCoverage(token: number, options?: { showLoading?: boolean }): Promise<void> {
    await this.coverageCoordinator.refresh(token, options);
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
    if (!restartBackend || !this.options.state.environment || !this.options.state.currentBuildUrl) {
      return;
    }

    try {
      const restartInfo = await restartBackend.getRestartFromStageInfo(
        this.options.state.environment,
        this.options.state.currentBuildUrl
      );
      if (!this.options.isTokenCurrent(token)) {
        return;
      }
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
    if (!this.options.state.takeCompletionToastSlot()) {
      return;
    }
    const buildUrl = this.options.state.currentBuildUrl;
    if (!buildUrl) {
      return;
    }
    const title = details.fullDisplayName ?? details.displayName ?? "Build";
    const resultLabel = formatBuildResultLabel(details);
    const action = "Open in Jenkins";
    const selection = await vscode.window.showInformationMessage(
      `${title} finished with status ${resultLabel}.`,
      action
    );
    if (selection !== action) {
      return;
    }
    await openExternalHttpUrlWithWarning(buildUrl, {
      targetLabel: "Jenkins URL",
      sourceLabel: "Build Details"
    });
  }

  handleBuildCompleted(details: JenkinsBuildDetails, token: number): void {
    void this.refreshRestartFromStageInfo(token, { postUpdate: true });
    void this.showCompletionToast(details);
    void this.refreshTestReport(token, { showLoading: true });
    void this.refreshCoverage(token, { showLoading: true });
  }

  private startCompletionPolling(token: number): void {
    if (!this.options.state.lastDetailsBuilding || !this.options.isTokenCurrent(token)) {
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
    if (!statusBackend || !this.options.state.environment || !this.options.state.currentBuildUrl) {
      return undefined;
    }
    try {
      const details = await statusBackend.getBuildDetails(
        this.options.state.environment,
        this.options.state.currentBuildUrl
      );
      if (!this.options.isTokenCurrent(token)) {
        return undefined;
      }
      return details;
    } catch {
      return undefined;
    }
  }

  private applyDetailsUpdate(details: JenkinsBuildDetails, updateUi: boolean): void {
    const { wasBuilding, isBuilding } = this.options.state.updateDetails(details);
    this.options.onBuildDetailsChanged?.(details);
    if (updateUi && this.options.view.isVisible()) {
      this.postStateUpdate();
      this.options.view.setTitle(details.fullDisplayName ?? details.displayName);
    }
    if (wasBuilding && !isBuilding) {
      this.handleBuildCompleted(details, this.options.getCurrentToken());
    }
  }

  private postStateUpdate(): void {
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
