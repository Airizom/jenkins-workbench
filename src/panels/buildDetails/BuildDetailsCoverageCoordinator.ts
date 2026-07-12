import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import {
  hasCoverageAction,
  resolveCoverageActionPath
} from "../../jenkins/coverage/JenkinsCoverageActionPath";
import type {
  JenkinsCoverageOverview,
  JenkinsModifiedCoverageFile
} from "../../jenkins/coverage/JenkinsCoverageTypes";
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
  buildCompleted: boolean;
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
      buildCompleted,
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
          { buildCompleted: request.buildCompleted }
        );
    if (this.isStale(token, refreshGeneration)) {
      return;
    }
    if (!actionPath) {
      this.clearResolvedCoverage();
      return;
    }
    this.options.state.setCoverageActionPath(actionPath);

    if (request.showLoading) {
      this.showCoverageLoading();
    }

    const result = await loadCoverage({
      coverageBackend: request.coverageBackend,
      environment: request.environment,
      buildUrl: request.buildUrl,
      buildCompleted: request.buildCompleted,
      actionPath,
      coverageEnabled: request.coverageEnabled,
      decorationsEnabled: request.decorationsEnabled
    });
    if (this.isStale(token, refreshGeneration)) {
      return;
    }

    this.applyCoverageResult(request, result);
  }

  private showCoverageLoading(): void {
    const changed = this.options.state.setCoverageLoading(true);
    if (changed && this.options.isViewVisible()) {
      this.options.postStateUpdate();
    }
  }

  private applyCoverageResult(
    request: CoverageRefreshRequest,
    result: BuildDetailsCoverageLoadResult
  ): void {
    const { coverageOverview, modifiedCoverageFiles } = result;
    this.options.state.setCoverage(
      request.coverageEnabled ? coverageOverview : undefined,
      request.coverageEnabled ? modifiedCoverageFiles : undefined
    );
    this.options.state.setCoverageLoading(false);
    this.options.decorationsAdapter.apply({
      environment: request.environment,
      buildUrl: request.buildUrl,
      modifiedCoverageFiles,
      coverageOverview,
      decorationsEnabled: request.decorationsEnabled
    });
    if (this.options.isViewVisible()) {
      this.options.decorationsAdapter.activate();
      this.options.postStateUpdate();
    }
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

interface BuildDetailsCoverageLoadResult {
  coverageOverview: JenkinsCoverageOverview | undefined;
  modifiedCoverageFiles: JenkinsModifiedCoverageFile[] | undefined;
}

interface BuildDetailsCoverageLoadRequest {
  coverageBackend: BuildDetailsCoverageBackend;
  environment: JenkinsEnvironmentRef;
  buildUrl: string;
  buildCompleted: boolean;
  actionPath: string;
  coverageEnabled: boolean;
  decorationsEnabled: boolean;
}

async function loadCoverage({
  coverageBackend,
  environment,
  buildUrl,
  buildCompleted,
  actionPath,
  coverageEnabled,
  decorationsEnabled
}: BuildDetailsCoverageLoadRequest): Promise<BuildDetailsCoverageLoadResult> {
  const coverageOverview = coverageEnabled
    ? await coverageBackend.getCoverageOverview(environment, buildUrl, {
        buildCompleted,
        actionPath
      })
    : undefined;

  let modifiedCoverageFiles: JenkinsModifiedCoverageFile[] | undefined;
  if (coverageEnabled || decorationsEnabled) {
    try {
      modifiedCoverageFiles = await coverageBackend.getModifiedCoverageFiles(
        environment,
        buildUrl,
        {
          buildCompleted,
          actionPath
        }
      );
    } catch (error) {
      if (!coverageOverview) {
        throw error;
      }
    }
  }

  return {
    coverageOverview,
    modifiedCoverageFiles
  };
}
