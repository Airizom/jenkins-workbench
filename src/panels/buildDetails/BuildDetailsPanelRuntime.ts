import * as vscode from "vscode";
import type { JenkinsBuildDetails } from "../../jenkins/types";
import { openExternalHttpUrlWithWarning } from "../../ui/OpenExternalUrl";
import { BuildDetailsCompletionPoller } from "./BuildDetailsCompletionPoller";
import { getBuildDetailsRefreshIntervalMs } from "./BuildDetailsConfig";
import { formatResult } from "./BuildDetailsFormatters";
import type { BuildDetailsPanelState } from "./BuildDetailsPanelState";
import type { BuildDetailsPanelView } from "./BuildDetailsPanelView";
import type {
  BuildDetailsDataService,
  BuildDetailsPollingController
} from "./BuildDetailsPollingController";
import type { BuildDetailsCanOpenTestSource } from "./BuildDetailsTestSource";
import { isPipelineRestartEligible } from "./PipelineRestartEligibility";

interface BuildDetailsPanelRuntimeOptions {
  state: BuildDetailsPanelState;
  view: BuildDetailsPanelView;
  getDataService: () => BuildDetailsDataService | undefined;
  getPollingController: () => BuildDetailsPollingController | undefined;
  getCurrentToken: () => number;
  isTokenCurrent: (token: number) => boolean;
  canOpenTestSource?: BuildDetailsCanOpenTestSource;
}

export class BuildDetailsPanelRuntime {
  private readonly completionPoller: BuildDetailsCompletionPoller;

  constructor(private readonly options: BuildDetailsPanelRuntimeOptions) {
    this.completionPoller = new BuildDetailsCompletionPoller({
      getRefreshIntervalMs: () => getBuildDetailsRefreshIntervalMs(),
      fetchBuildDetails: (token) => this.fetchBuildDetails(token),
      isTokenCurrent: (token) => this.options.isTokenCurrent(token),
      shouldPoll: () => this.options.state.lastDetailsBuilding,
      onDetailsUpdate: (details) => this.applyDetailsUpdate(details, false)
    });
  }

  dispose(): void {
    this.stopCompletionPolling();
  }

  handlePanelHidden(token: number): void {
    this.options.getPollingController()?.stop();
    this.startCompletionPolling(token);
  }

  async handlePanelVisible(token: number): Promise<void> {
    this.stopCompletionPolling();
    await this.refreshBuildStatus(token);
    if (this.options.state.lastDetailsBuilding) {
      this.options.getPollingController()?.start();
      return;
    }
    await Promise.all([
      this.refreshConsoleSnapshot(token),
      this.refreshTestReport(token, { showLoading: true }),
      this.refreshWorkflowRun(token),
      this.options.getPollingController()?.refreshPendingInputs()
    ]);
    void this.refreshRestartFromStageInfo(token, { postUpdate: true });
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

  async refreshWorkflowRun(token: number): Promise<void> {
    await this.options.getPollingController()?.fetchWorkflowRunWithCallbacks(token);
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
      !this.options.getDataService() ||
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
      if (!this.options.isTokenCurrent(token)) {
        return;
      }
      this.options.state.setTestReport(testReport, {
        logsIncluded: Boolean(effectiveOptions?.includeCaseLogs)
      });
      this.options.state.setTestResultsLoading(false);
      this.postStateUpdate();
    } catch {
      if (this.options.isTokenCurrent(token)) {
        this.options.state.markTestReportFetchAttempted();
        if (options?.showLoading) {
          const changed = this.options.state.setTestResultsLoading(false);
          if (changed && this.options.view.isVisible()) {
            this.postStateUpdate();
          }
        } else if (this.options.view.isVisible()) {
          this.postStateUpdate();
        }
      }
      return;
    }
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

    const dataService = this.options.getDataService();
    if (!dataService || !this.options.state.environment || !this.options.state.currentBuildUrl) {
      return;
    }

    try {
      const restartInfo = await dataService.getRestartFromStageInfo(
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
    const title = details.fullDisplayName ?? details.displayName ?? "Build";
    const resultLabel = formatResult(details);
    const action = "Open in Jenkins";
    const selection = await vscode.window.showInformationMessage(
      `${title} finished with status ${resultLabel}.`,
      action
    );
    if (selection !== action || !this.options.state.currentBuildUrl) {
      return;
    }
    await openExternalHttpUrlWithWarning(this.options.state.currentBuildUrl, {
      targetLabel: "Jenkins URL",
      sourceLabel: "Build Details"
    });
  }

  private startCompletionPolling(token: number): void {
    if (!this.options.state.lastDetailsBuilding || !this.options.isTokenCurrent(token)) {
      return;
    }
    if (!this.options.getDataService() || !this.options.state.environment) {
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
    const dataService = this.options.getDataService();
    if (!dataService || !this.options.state.environment || !this.options.state.currentBuildUrl) {
      return undefined;
    }
    try {
      const details = await dataService.getBuildDetails(
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
    if (updateUi && this.options.view.isVisible()) {
      this.postStateUpdate();
      this.options.view.setTitle(details.fullDisplayName ?? details.displayName);
    }
    if (wasBuilding && !isBuilding) {
      const token = this.options.getCurrentToken();
      void this.refreshRestartFromStageInfo(token, { postUpdate: true });
      void this.showCompletionToast(details);
      void this.refreshTestReport(token, { showLoading: true });
    }
  }

  private postStateUpdate(): void {
    this.options.view.postStateUpdate(this.options.state, {
      canOpenSource: (className) =>
        this.options.canOpenTestSource?.(
          this.options.state.environment,
          this.options.state.currentBuildUrl,
          className
        ) ?? false
    });
  }
}
