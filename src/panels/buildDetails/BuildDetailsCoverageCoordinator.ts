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

  handlePanelVisible(): void {
    this.options.decorationsAdapter.activate();
  }

  handlePanelHidden(): void {
    this.options.decorationsAdapter.deactivate();
  }

  async refresh(token: number, options?: { showLoading?: boolean }): Promise<void> {
    const refreshGeneration = ++this.refreshGeneration;
    const plan = planCoverageRefresh({
      coverageBackend: this.options.getCoverageBackend(),
      environment: this.options.state.environment,
      buildUrl: this.options.state.currentBuildUrl,
      details: this.options.state.currentDetails,
      coverageEnabled: getBuildDetailsCoverageEnabled(),
      decorationsEnabled: getBuildDetailsCoverageDecorationsEnabled(),
      showLoadingRequested: Boolean(options?.showLoading)
    });

    if (plan.kind === "skip") {
      return;
    }
    if (plan.kind === "clear") {
      this.clearResolvedCoverage();
      return;
    }

    try {
      await this.loadCoverageForRequest(token, refreshGeneration, plan.request);
    } catch (error) {
      this.handleRefreshError(token, refreshGeneration, error);
    }
  }

  private async loadCoverageForRequest(
    token: number,
    refreshGeneration: number,
    request: CoverageRefreshRequest
  ): Promise<void> {
    const actionPath = hasCoverageAction(request.details)
      ? resolveCoverageActionPath(request.details)
      : await request.coverageBackend.discoverCoverageActionPath(
          request.environment,
          request.buildUrl,
          { buildCompleted: true }
        );
    if (this.isStale(token, refreshGeneration)) {
      return;
    }
    if (!actionPath) {
      this.clearResolvedCoverage(true);
      return;
    }
    this.options.state.setCoverageActionPath(actionPath);

    if (request.showLoading) {
      this.showCoverageLoading();
    }

    const result = await loadCoverage(request, actionPath);
    if (this.isStale(token, refreshGeneration)) {
      return;
    }

    this.applyCoverageResult(request, result);
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

  private handleRefreshError(token: number, refreshGeneration: number, error: unknown): void {
    if (this.isStale(token, refreshGeneration)) {
      return;
    }
    this.options.decorationsAdapter.clear();
    this.options.state.setCoverageError(formatError(error));
    this.options.state.setCoverageLoading(false);
    this.postStateUpdateIfVisible();
  }

  private isStale(token: number, refreshGeneration: number): boolean {
    return !this.options.isTokenCurrent(token) || refreshGeneration !== this.refreshGeneration;
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
}

async function loadCoverage(
  request: CoverageRefreshRequest,
  actionPath: string
): Promise<BuildDetailsCoverageLoadResult> {
  const { coverageBackend, environment, buildUrl, coverageEnabled, decorationsEnabled } = request;
  let coverageOverview: JenkinsCoverageOverview | undefined;
  let overviewError: string | undefined;
  if (coverageEnabled) {
    try {
      coverageOverview = await coverageBackend.getCoverageOverview(environment, buildUrl, {
        buildCompleted: true,
        actionPath
      });
    } catch (error) {
      overviewError = formatError(error);
    }
  }

  let modifiedCoverageFiles: JenkinsModifiedCoverageFile[] | undefined;
  if (coverageEnabled || decorationsEnabled) {
    try {
      modifiedCoverageFiles = await coverageBackend.getModifiedCoverageFiles(
        environment,
        buildUrl,
        {
          buildCompleted: true,
          actionPath
        }
      );
    } catch (error) {
      if (!coverageOverview && overviewError === undefined) {
        throw error;
      }
    }
  }

  return {
    coverageOverview,
    modifiedCoverageFiles,
    overviewError
  };
}
