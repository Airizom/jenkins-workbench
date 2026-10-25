import { randomUUID } from "node:crypto";
import {
  resolveBuildResultClass,
  resolveBuildResultLabel
} from "../../formatters/BuildStatusFormatters";
import { type BuildRelationship, extractUpstreamBuilds } from "../../jenkins/BuildRelationships";
import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import type { JenkinsBuildDetails } from "../../jenkins/types";
import type { BuildDetailsBackend } from "./BuildDetailsBackend";
import { getRelatedBuildSearchLimits } from "./BuildDetailsConfig";
import { formatError } from "./BuildDetailsFormatters";
import {
  type BuildRelationshipsViewModel,
  EMPTY_BUILD_RELATIONSHIPS,
  type RelatedBuildViewModel
} from "./shared/BuildDetailsContracts";

/** Owns only the active build's relationship search; never participates in build polling. */
export class BuildRelationshipsController {
  private state: BuildRelationshipsViewModel = this.emptyState();
  private readonly targets = new Map<string, BuildRelationship>();
  private environment?: JenkinsEnvironmentRef;
  private buildUrl?: string;
  private backend?: BuildDetailsBackend["relationships"];
  private search?: AbortController;
  private expanded = false;
  private upstreamLoaded = false;

  constructor(
    private readonly publish: (state: BuildRelationshipsViewModel) => void,
    private readonly isVisible: () => boolean
  ) {}

  getState(): BuildRelationshipsViewModel {
    return this.state;
  }

  getTarget(targetId: string): BuildRelationship | undefined {
    return this.targets.get(targetId);
  }

  clear(): void {
    this.cancel();
    this.targets.clear();
    this.environment = undefined;
    this.buildUrl = undefined;
    this.backend = undefined;
    this.expanded = false;
    this.upstreamLoaded = false;
    this.state = this.emptyState();
  }

  initialize(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    backend: BuildDetailsBackend["relationships"],
    details?: JenkinsBuildDetails
  ): void {
    this.environment = environment;
    this.buildUrl = buildUrl;
    this.backend = backend;
    this.upstreamLoaded = Boolean(details);
    this.state = {
      ...this.emptyState(),
      upstream: details
        ? extractUpstreamBuilds(environment.url, details).map((build) => this.toViewModel(build))
        : []
    };
  }

  updateUpstream(details: JenkinsBuildDetails): void {
    if (this.upstreamLoaded || !this.environment) return;
    this.upstreamLoaded = true;
    this.update({
      ...this.state,
      upstream: extractUpstreamBuilds(this.environment.url, details).map((build) =>
        this.toViewModel(build)
      )
    });
  }

  setExpanded(expanded: boolean): void {
    this.expanded = expanded;
    if (!expanded) {
      this.cancel();
    } else if (!this.state.searched && !this.search) {
      void this.refresh();
    }
  }

  handleHidden(): void {
    this.cancel();
  }

  async refresh(): Promise<void> {
    const environment = this.environment;
    const buildUrl = this.buildUrl;
    const backend = this.backend;
    if (!environment || !buildUrl || !this.expanded || !this.isVisible()) {
      return;
    }
    this.cancel();
    if (!backend) {
      this.update({ ...this.state, error: "Downstream discovery is unavailable." });
      return;
    }
    const search = new AbortController();
    this.search = search;
    this.update({ ...this.state, loading: true, error: undefined });
    try {
      const result = await backend.getDownstreamBuilds(environment, buildUrl, {
        ...getRelatedBuildSearchLimits(),
        signal: search.signal,
        bypassCache: true
      });
      if (this.search !== search || search.signal.aborted) return;
      if (result.partialReasons.length > 0 && result.buildsSearched === 0 && this.state.searched) {
        this.update({
          ...this.state,
          loading: false,
          partialReasons: result.partialReasons,
          error: "Unable to refresh downstream builds completely. Showing the previous results."
        });
        return;
      }
      // Incomplete scans cannot disprove previously confirmed relationships.
      const foundUrls = new Set(result.builds.map((build) => build.buildUrl));
      const retained = this.state.downstream.filter((entry) => {
        const build = this.targets.get(entry.targetId);
        return result.partialReasons.length > 0 && build && !foundUrls.has(build.buildUrl);
      });
      const retainedIds = new Set(retained.map((entry) => entry.targetId));
      for (const entry of this.state.downstream) {
        if (!retainedIds.has(entry.targetId)) this.targets.delete(entry.targetId);
      }
      this.update({
        ...this.state,
        downstream: [...result.builds.map((build) => this.toViewModel(build)), ...retained],
        loading: false,
        searched: true,
        lastCheckedAt: result.checkedAt,
        jobsSearched: result.jobsSearched,
        buildsSearched: result.buildsSearched,
        partialReasons: result.partialReasons,
        error: undefined
      });
    } catch (error) {
      if (this.search === search && !search.signal.aborted) {
        this.update({
          ...this.state,
          loading: false,
          error: `Unable to find downstream builds: ${formatError(error)}`
        });
      }
    } finally {
      if (this.search === search) this.search = undefined;
    }
  }

  private cancel(): void {
    this.search?.abort();
    this.search = undefined;
    if (this.state.loading) this.update({ ...this.state, loading: false });
  }

  private update(state: BuildRelationshipsViewModel): void {
    this.state = state;
    this.publish(state);
  }

  private toViewModel(build: BuildRelationship): RelatedBuildViewModel {
    const targetId = randomUUID();
    this.targets.set(targetId, build);
    const hasStatus = build.building !== undefined || build.result !== undefined;
    return {
      targetId,
      jobName: build.jobName,
      number: build.number,
      ...(hasStatus
        ? {
            resultLabel: resolveBuildResultLabel(build.result ?? undefined, build.building),
            resultClass: resolveBuildResultClass(build.result ?? undefined, build.building)
          }
        : {})
    };
  }

  private emptyState(): BuildRelationshipsViewModel {
    return { ...EMPTY_BUILD_RELATIONSHIPS, upstream: [], downstream: [], partialReasons: [] };
  }
}
