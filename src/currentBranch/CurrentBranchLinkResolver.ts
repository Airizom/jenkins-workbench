import { getAttachedBranchName } from "../git/GitExtensionApi";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import type { JenkinsEnvironmentStore } from "../storage/JenkinsEnvironmentStore";
import type {
  JenkinsRepositoryLinkEnvironment,
  JenkinsRepositoryLinkStore
} from "../storage/JenkinsRepositoryLinkStore";
import { resolveCurrentBranchEnvironmentRef } from "./CurrentBranchEnvironmentResolver";
import { toRepositoryInfo } from "./CurrentBranchRepositoryUtils";
import type {
  CurrentBranchLinkedContext,
  CurrentBranchRepositoryContext,
  CurrentBranchState
} from "./CurrentBranchTypes";

export class CurrentBranchLinkResolver {
  readonly onDidChange;

  constructor(
    private readonly environmentStore: JenkinsEnvironmentStore,
    private readonly linkStore: JenkinsRepositoryLinkStore
  ) {
    this.onDidChange = linkStore.onDidChange;
  }

  async resolve(
    repository: CurrentBranchRepositoryContext
  ): Promise<CurrentBranchState | CurrentBranchLinkedContext> {
    const repositoryInfo = toRepositoryInfo(repository);
    const branchName = getAttachedBranchName(repository.repository.state.HEAD);
    const link = this.linkStore.getLink(repository.repositoryUriString);
    if (!link) {
      return {
        kind: "unlinked",
        repository: repositoryInfo
      };
    }

    const environment = await this.resolveEnvironment(link.environment);
    if (!environment) {
      return {
        kind: "requestFailed",
        repository: repositoryInfo,
        branchName,
        link,
        message: this.formatMissingEnvironmentMessage(link.environment)
      };
    }

    if (!branchName) {
      return {
        kind: "detachedHead",
        repository: repositoryInfo,
        link,
        environment
      };
    }

    return {
      kind: "linked",
      repository,
      branchName,
      link,
      environment
    };
  }

  private async resolveEnvironment(
    environment: JenkinsRepositoryLinkEnvironment
  ): Promise<JenkinsEnvironmentRef | undefined> {
    return resolveCurrentBranchEnvironmentRef(this.environmentStore, environment);
  }

  private formatMissingEnvironmentMessage(environment: JenkinsRepositoryLinkEnvironment): string {
    const scopeLabel = environment.scope === "workspace" ? "workspace-scoped" : "global";
    return `The linked Jenkins environment "${environment.environmentId}" (${scopeLabel}) is not available in this window.`;
  }
}
