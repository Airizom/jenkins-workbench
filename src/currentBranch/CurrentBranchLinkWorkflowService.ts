import type { JenkinsDataService } from "../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import type { JenkinsEnvironmentStore } from "../storage/JenkinsEnvironmentStore";
import type {
  JenkinsRepositoryLink,
  JenkinsRepositoryLinkStore
} from "../storage/JenkinsRepositoryLinkStore";
import type { CurrentBranchRepositoryInfo, CurrentBranchState } from "./CurrentBranchTypes";

export type CurrentBranchLinkableEnvironment = {
  environment: JenkinsRepositoryLink["environment"];
  environmentUrl: string;
};

export type CurrentBranchEnvironmentDiscoveryResult =
  | {
      kind: "noEnvironments";
    }
  | {
      kind: "loaded";
      environments: CurrentBranchLinkableEnvironment[];
    };

export type CurrentBranchMultibranchTarget = {
  environment: JenkinsRepositoryLink["environment"];
  environmentUrl: string;
  multibranchFolderUrl: string;
  multibranchLabel: string;
};

export type CurrentBranchMultibranchDiscoveryResult =
  | {
      kind: "loaded";
      targets: CurrentBranchMultibranchTarget[];
    }
  | {
      kind: "failed";
      environment: JenkinsRepositoryLink["environment"];
      message: string;
    };

export type CurrentBranchMultibranchScanResult = {
  message: string;
  environmentId: string;
};

export class CurrentBranchLinkWorkflowService {
  constructor(
    private readonly environmentStore: JenkinsEnvironmentStore,
    private readonly dataService: JenkinsDataService,
    private readonly linkStore: JenkinsRepositoryLinkStore
  ) {}

  async listLinkableEnvironments(): Promise<CurrentBranchEnvironmentDiscoveryResult> {
    const environments = await this.environmentStore.listEnvironmentsWithScope();
    if (environments.length === 0) {
      return { kind: "noEnvironments" };
    }

    return {
      kind: "loaded",
      environments: environments
        .map((environment) => ({
          environment: {
            environmentId: environment.id,
            scope: environment.scope
          },
          environmentUrl: environment.url
        }))
        .sort((left, right) =>
          `${left.environment.scope}/${left.environment.environmentId}`.localeCompare(
            `${right.environment.scope}/${right.environment.environmentId}`
          )
        )
    };
  }

  async discoverMultibranchTargets(
    environment: JenkinsRepositoryLink["environment"]
  ): Promise<CurrentBranchMultibranchDiscoveryResult> {
    const environmentRef = await this.resolveEnvironment(environment);
    if (!environmentRef) {
      return {
        kind: "failed",
        environment,
        message: "The selected Jenkins environment no longer exists."
      };
    }

    try {
      const jobs = await this.dataService.getMultibranchJobsForEnvironment(environmentRef, {
        mode: "refresh"
      });
      const targets = jobs
        .map((job) => ({
          environment,
          environmentUrl: environmentRef.url,
          multibranchFolderUrl: job.url,
          multibranchLabel: job.fullName
        }))
        .sort((left, right) => left.multibranchLabel.localeCompare(right.multibranchLabel));
      return {
        kind: "loaded",
        targets
      };
    } catch (error) {
      return {
        kind: "failed",
        environment,
        message: error instanceof Error ? error.message : "Unexpected Jenkins error."
      };
    }
  }

  async linkRepository(
    repository: CurrentBranchRepositoryInfo,
    target: CurrentBranchMultibranchTarget
  ): Promise<void> {
    await this.linkStore.setLink(repository.repositoryUriString, {
      environment: target.environment,
      multibranchFolderUrl: target.multibranchFolderUrl,
      multibranchLabel: target.multibranchLabel
    });
  }

  async unlinkRepository(repository: CurrentBranchRepositoryInfo): Promise<boolean> {
    return this.linkStore.clearLink(repository.repositoryUriString);
  }

  async scanLinkedMultibranch(
    state: CurrentBranchState
  ): Promise<CurrentBranchMultibranchScanResult | undefined> {
    if (state.kind !== "branchMissing") {
      return undefined;
    }

    const result = await this.dataService.scanMultibranch(
      state.environment,
      state.link.multibranchFolderUrl
    );
    return {
      message: result.queueLocation
        ? `Triggered a multibranch scan. Queued at ${result.queueLocation}`
        : "Triggered a multibranch scan.",
      environmentId: state.environment.environmentId
    };
  }

  private async resolveEnvironment(
    environment: JenkinsRepositoryLink["environment"]
  ): Promise<JenkinsEnvironmentRef | undefined> {
    const environments = await this.environmentStore.listEnvironmentsWithScope();
    const match = environments.find(
      (entry) => entry.id === environment.environmentId && entry.scope === environment.scope
    );
    if (!match) {
      return undefined;
    }

    return {
      environmentId: match.id,
      scope: match.scope,
      url: match.url,
      username: match.username
    };
  }
}
