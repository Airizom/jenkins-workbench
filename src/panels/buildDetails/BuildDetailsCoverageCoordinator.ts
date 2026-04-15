import {
  hasCoverageAction,
  resolveCoverageActionPath
} from "../../jenkins/coverage/JenkinsCoverageActionPath";
import type { BuildDetailsCoverageBackend } from "./BuildDetailsBackend";
import {
  getBuildDetailsCoverageDecorationsEnabled,
  getBuildDetailsCoverageEnabled
} from "./BuildDetailsConfig";
import type { BuildDetailsCoverageDecorationsAdapter } from "./BuildDetailsCoverageDecorationsAdapter";
import { BuildDetailsCoverageLoader } from "./BuildDetailsCoverageLoader";
import { formatError } from "./BuildDetailsFormatters";
import type { BuildDetailsPanelState } from "./BuildDetailsPanelState";

interface BuildDetailsCoverageCoordinatorOptions {
  state: BuildDetailsPanelState;
  decorationsAdapter: BuildDetailsCoverageDecorationsAdapter;
  getCoverageBackend: () => BuildDetailsCoverageBackend | undefined;
  isTokenCurrent: (token: number) => boolean;
  isViewVisible: () => boolean;
  postStateUpdate: () => void;
}

export class BuildDetailsCoverageCoordinator {
  private readonly loader = new BuildDetailsCoverageLoader();
  private refreshGeneration = 0;

  constructor(private readonly options: BuildDetailsCoverageCoordinatorOptions) {}

  dispose(): void {
    this.options.decorationsAdapter.dispose();
  }

  handlePanelVisible(): void {
    this.options.decorationsAdapter.activate();
  }

  handlePanelHidden(): void {
    this.options.decorationsAdapter.deactivate();
  }

  async refresh(token: number, options?: { showLoading?: boolean }): Promise<void> {
    const refreshGeneration = ++this.refreshGeneration;
    const coverageBackend = this.options.getCoverageBackend();
    const environment = this.options.state.environment;
    const buildUrl = this.options.state.currentBuildUrl;
    const details = this.options.state.currentDetails;
    const buildCompleted = !details?.building;
    const coverageEnabled = getBuildDetailsCoverageEnabled();
    const decorationsEnabled = getBuildDetailsCoverageDecorationsEnabled();

    if (!coverageBackend || !environment || !buildUrl) {
      return;
    }

    if (!buildCompleted || (!coverageEnabled && !decorationsEnabled)) {
      this.clearResolvedCoverage();
      return;
    }

    const actionPath = hasCoverageAction(details)
      ? resolveCoverageActionPath(details)
      : await coverageBackend.discoverCoverageActionPath(environment, buildUrl, { buildCompleted });
    if (!this.options.isTokenCurrent(token) || refreshGeneration !== this.refreshGeneration) {
      return;
    }
    if (!actionPath) {
      this.clearResolvedCoverage();
      return;
    }
    this.options.state.setCoverageActionPath(actionPath);

    if (options?.showLoading && coverageEnabled) {
      const changed = this.options.state.setCoverageLoading(true);
      if (changed && this.options.isViewVisible()) {
        this.options.postStateUpdate();
      }
    }

    try {
      const { coverageOverview, modifiedCoverageFiles } = await this.loader.load({
        coverageBackend,
        environment,
        buildUrl,
        buildCompleted,
        actionPath,
        coverageEnabled,
        decorationsEnabled
      });
      if (!this.options.isTokenCurrent(token) || refreshGeneration !== this.refreshGeneration) {
        return;
      }

      this.options.state.setCoverage(
        coverageEnabled ? coverageOverview : undefined,
        coverageEnabled ? modifiedCoverageFiles : undefined
      );
      this.options.state.setCoverageLoading(false);
      this.options.decorationsAdapter.apply({
        environment,
        buildUrl,
        modifiedCoverageFiles,
        coverageOverview,
        decorationsEnabled
      });
      if (this.options.isViewVisible()) {
        this.options.decorationsAdapter.activate();
        this.options.postStateUpdate();
      }
    } catch (error) {
      if (!this.options.isTokenCurrent(token) || refreshGeneration !== this.refreshGeneration) {
        return;
      }
      this.options.decorationsAdapter.clear();
      this.options.state.setCoverageError(formatError(error));
      this.options.state.setCoverageLoading(false);
      this.postStateUpdateIfVisible();
    }
  }

  private clearResolvedCoverage(): void {
    this.options.decorationsAdapter.clear();
    this.options.state.resetCoverage();
    this.postStateUpdateIfVisible();
  }

  private postStateUpdateIfVisible(): void {
    if (!this.options.isViewVisible()) {
      return;
    }
    this.options.postStateUpdate();
  }
}
