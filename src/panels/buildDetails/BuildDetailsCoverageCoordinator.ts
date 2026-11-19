import {
  hasCoverageAction,
  resolveCoverageActionPath
} from "../../jenkins/coverage/JenkinsCoverageActionPath";
import type {
  JenkinsCoverageOverview,
  JenkinsModifiedCoverageFile
} from "../../jenkins/coverage/JenkinsCoverageTypes";
import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import type { JenkinsBuildDetails } from "../../jenkins/types";
import type { BuildDetailsCoverageBackend } from "./BuildDetailsBackend";
import {
  getBuildDetailsCoverageDecorationsEnabled,
  getBuildDetailsCoverageEnabled
} from "./BuildDetailsConfig";
import type { BuildDetailsCoverageDecorationsAdapter } from "./BuildDetailsCoverageDecorationsAdapter";
import { formatError } from "./BuildDetailsFormatters";
import type { BuildDetailsPanelState } from "./BuildDetailsPanelState";
import type { PanelRunTarget } from "./BuildDetailsRunIdentity";

interface BuildDetailsCoverageCoordinatorOptions {
  state: BuildDetailsPanelState;
  decorationsAdapter: BuildDetailsCoverageDecorationsAdapter;
  getCoverageBackend: () => BuildDetailsCoverageBackend | undefined;
  isTokenCurrent: (token: number) => boolean;
  isViewVisible: () => boolean;
  postStateUpdate: () => void;
}

export interface CoverageRefreshContext {
  coverageBackend: BuildDetailsCoverageBackend | undefined;
  environment: JenkinsEnvironmentRef | undefined;
  buildUrl: string | undefined;
  details: JenkinsBuildDetails | undefined;
  coverageEnabled: boolean;
  decorationsEnabled: boolean;
  showLoadingRequested: boolean;
}

export interface CoverageRefreshRequest {
  coverageBackend: BuildDetailsCoverageBackend;
  environment: JenkinsEnvironmentRef;
  buildUrl: string;
  details: JenkinsBuildDetails | undefined;
  coverageEnabled: boolean;
  decorationsEnabled: boolean;
  showLoading: boolean;
}

export type CoverageRefreshPlan =
  | { kind: "skip" }
  | { kind: "clear" }
  | { kind: "load"; request: CoverageRefreshRequest };

export function planCoverageRefresh(context: CoverageRefreshContext): CoverageRefreshPlan {
  const { coverageBackend, environment, buildUrl, details } = context;
  const buildCompleted = !details?.building;

  if (!coverageBackend || !environment || !buildUrl) {
    return { kind: "skip" };
  }

  if (!buildCompleted || (!context.coverageEnabled && !context.decorationsEnabled)) {
    return { kind: "clear" };
  }

  return {
    kind: "load",
    request: {
      coverageBackend,
      environment,
      buildUrl,
      details,
      coverageEnabled: context.coverageEnabled,
      decorationsEnabled: context.decorationsEnabled,
      showLoading: Boolean(context.showLoadingRequested && context.coverageEnabled)
    }
  };
}

export class BuildDetailsCoverageCoordinator {
  private refreshGeneration = 0;

  constructor(private readonly options: BuildDetailsCoverageCoordinatorOptions) {}

  dispose(): void {
    this.refreshGeneration += 1;
    this.options.decorationsAdapter.dispose();
  }

  clearRunDecorations(): void {
    this.options.decorationsAdapter.clear();
  }

  handlePanelVisible(): void {
    this.options.decorationsAdapter.activate();
  }

  handlePanelHidden(): void {
    this.options.decorationsAdapter.deactivate();
  }

  /** Returns false when part of the requested coverage data should be retried. */
  async refresh(token: number, options?: { showLoading?: boolean }): Promise<boolean> {
    if (!this.options.isTokenCurrent(token)) return true;
    const refreshGeneration = ++this.refreshGeneration;
    const run = this.options.state.terminalRun;
    const isCurrent = () =>
      this.options.isTokenCurrent(token) &&
      refreshGeneration === this.refreshGeneration &&
      this.options.state.terminalRun === run;
    const plan = planCoverageRefresh({
      coverageBackend: this.options.getCoverageBackend(),
      environment: this.options.state.environment,
      buildUrl:
        this.options.state.currentDetails?.building === false
          ? run?.buildUrl
          : this.options.state.currentBuildUrl,
      details: this.options.state.currentDetails,
      coverageEnabled: getBuildDetailsCoverageEnabled(),
      decorationsEnabled: getBuildDetailsCoverageDecorationsEnabled(),
      showLoadingRequested: Boolean(options?.showLoading)
    });

    if (plan.kind === "skip") {
      return true;
    }
    if (plan.kind === "clear") {
      this.clearResolvedCoverage();
      return true;
    }

    try {
      if (!run) return true;
      return await this.loadCoverageForRequest(plan.request, run, isCurrent);
    } catch (error) {
      if (isCurrent()) this.handleRefreshError(error);
      return false;
    }
  }

  private async loadCoverageForRequest(
    request: CoverageRefreshRequest,
    run: PanelRunTarget,
    isCurrent: () => boolean
  ): Promise<boolean> {
    const actionPath = hasCoverageAction(request.details)
      ? resolveCoverageActionPath(request.details)
      : await request.coverageBackend.discoverCoverageActionPath(
          request.environment,
          request.buildUrl,
          { buildCompleted: true, run }
        );
    if (!isCurrent()) {
      return true;
    }
    if (!actionPath) {
      this.clearResolvedCoverage(true);
      return true;
    }
    this.options.state.setCoverageActionPath(actionPath);

    if (request.showLoading) {
      this.showCoverageLoading();
    }

    const result = await loadCoverage(request, run, actionPath, isCurrent);
    if (!isCurrent()) {
      return true;
    }

    this.applyCoverageResult(request, result);
    return result.overviewError === undefined && !result.modifiedFilesFailed;
  }

  private showCoverageLoading(): void {
    const changed = this.options.state.setCoverageLoading(true);
    if (changed) {
      this.postStateUpdateIfVisible();
    }
  }

  private applyCoverageResult(
    request: CoverageRefreshRequest,
    result: BuildDetailsCoverageLoadResult
  ): void {
    const { coverageOverview, modifiedCoverageFiles, overviewError } = result;
    if (overviewError !== undefined) {
      this.options.state.setCoverageError(overviewError);
    } else {
      this.options.state.setCoverage(
        request.coverageEnabled ? coverageOverview : undefined,
        request.coverageEnabled ? modifiedCoverageFiles : undefined
      );
    }
    this.options.state.setCoverageLoading(false);
    this.options.decorationsAdapter.apply({
      environment: request.environment,
      buildUrl: request.buildUrl,
      modifiedCoverageFiles,
      decorationsEnabled: request.decorationsEnabled
    });
    if (this.options.isViewVisible()) {
      this.options.decorationsAdapter.activate();
    }
    this.postStateUpdateIfVisible();
  }

  private handleRefreshError(error: unknown): void {
    this.options.decorationsAdapter.clear();
    this.options.state.setCoverageError(formatError(error));
    this.options.state.setCoverageLoading(false);
    this.postStateUpdateIfVisible();
  }

  private clearResolvedCoverage(fetched = false): void {
    this.options.decorationsAdapter.clear();
    this.options.state.resetCoverage();
    if (fetched) {
      this.options.state.setCoverage(undefined, undefined);
    }
    this.postStateUpdateIfVisible();
  }

  private postStateUpdateIfVisible(): void {
    if (!this.options.isViewVisible()) {
      return;
    }
    this.options.postStateUpdate();
  }
}

interface BuildDetailsCoverageLoadResult {
  coverageOverview: JenkinsCoverageOverview | undefined;
  modifiedCoverageFiles: JenkinsModifiedCoverageFile[] | undefined;
  overviewError?: string;
  modifiedFilesFailed: boolean;
}

async function loadCoverage(
  request: CoverageRefreshRequest,
  run: PanelRunTarget,
  actionPath: string,
  isCurrent: () => boolean
): Promise<BuildDetailsCoverageLoadResult> {
  const { coverageBackend, environment, buildUrl, coverageEnabled, decorationsEnabled } = request;
  let coverageOverview: JenkinsCoverageOverview | undefined;
  let overviewError: string | undefined;
  if (coverageEnabled) {
    try {
      coverageOverview = await coverageBackend.getCoverageOverview(environment, buildUrl, {
        buildCompleted: true,
        run,
        actionPath
      });
    } catch (error) {
      overviewError = formatError(error);
    }
  }

  let modifiedCoverageFiles: JenkinsModifiedCoverageFile[] | undefined;
  let modifiedFilesFailed = false;
  if ((coverageEnabled || decorationsEnabled) && isCurrent()) {
    try {
      modifiedCoverageFiles = await coverageBackend.getModifiedCoverageFiles(
        environment,
        buildUrl,
        {
          buildCompleted: true,
          run,
          actionPath
        }
      );
    } catch (error) {
      modifiedFilesFailed = true;
      if (!coverageOverview && overviewError === undefined) {
        throw error;
      }
    }
  }

  return {
    coverageOverview,
    modifiedCoverageFiles,
    overviewError,
    modifiedFilesFailed
  };
}
