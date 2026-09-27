import type { JenkinsBuildDetails } from "../../jenkins/types";
import { getBuildDetailsRefreshIntervalMs } from "./BuildDetailsConfig";
import type { BuildDetailsPanelRuntime } from "./BuildDetailsPanelRuntime";
import type { BuildDetailsPanelState } from "./BuildDetailsPanelState";
import type { BuildDetailsPanelView } from "./BuildDetailsPanelView";
import type { BuildDetailsPollingController } from "./BuildDetailsPollingController";

const MAX_INITIAL_STATUS_RETRIES = 5;
const BUILD_DETAILS_ERROR_PREFIX = "Build details: ";

export interface BuildDetailsInitialActivationOptions {
  token: number;
  workflowError: unknown;
  state: BuildDetailsPanelState;
  view: Pick<BuildDetailsPanelView, "isVisible">;
  runtime: Pick<
    BuildDetailsPanelRuntime,
    "refreshBuildStatus" | "refreshTestReport" | "refreshCoverage" | "handlePanelHidden"
  >;
  getPollingController: () => BuildDetailsPollingController | undefined;
  isTokenCurrent: (token: number) => boolean;
  publishErrors: () => void;
}

/**
 * Starts the runtime work for a freshly loaded build (visible polling, hidden completion
 * polling, or the completed-build test/coverage fetch) for a single load token. When the
 * initial details request failed, retries the status fetch a bounded number of times so a
 * transient failure does not leave the panel stuck on its initial error state.
 */
export class BuildDetailsInitialActivation {
  private retryTimer: NodeJS.Timeout | undefined;

  constructor(private readonly options: BuildDetailsInitialActivationOptions) {}

  dispose(): void {
    this.clearRetry();
  }

  async activate(details: JenkinsBuildDetails | undefined): Promise<void> {
    if (!details) {
      this.scheduleRetry(1);
      return;
    }
    if (details.building) {
      this.activateRunningBuild();
      return;
    }
    await this.activateCompletedBuild();
  }

  private scheduleRetry(attempt: number): void {
    if (attempt > MAX_INITIAL_STATUS_RETRIES || !this.options.isTokenCurrent(this.options.token)) {
      return;
    }
    this.clearRetry();
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      void this.retry(attempt);
    }, getBuildDetailsRefreshIntervalMs());
  }

  private async retry(attempt: number): Promise<void> {
    const { token, isTokenCurrent, runtime, state } = this.options;
    if (!isTokenCurrent(token)) {
      return;
    }
    await runtime.refreshBuildStatus(token);
    if (!isTokenCurrent(token)) {
      return;
    }
    const details = state.currentDetails;
    if (!details) {
      this.scheduleRetry(attempt + 1);
      return;
    }
    state.removeBaseErrors((error) => error.startsWith(BUILD_DETAILS_ERROR_PREFIX));
    this.options.publishErrors();
    await this.activate(details);
  }

  private clearRetry(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = undefined;
    }
  }

  private async activateCompletedBuild(): Promise<void> {
    const { token, runtime } = this.options;
    if (this.options.workflowError && this.options.view.isVisible()) {
      this.options.getPollingController()?.start();
    }
    await Promise.all([
      runtime.refreshTestReport(token, { showLoading: true }),
      runtime.refreshCoverage(token, { showLoading: true })
    ]);
  }

  private activateRunningBuild(): void {
    if (this.options.view.isVisible()) {
      this.options.getPollingController()?.start();
      return;
    }
    this.options.runtime.handlePanelHidden(this.options.token);
  }
}
