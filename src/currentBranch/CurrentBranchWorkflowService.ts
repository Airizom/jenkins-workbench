import * as vscode from "vscode";
import type { CurrentBranchActionExecutor } from "./CurrentBranchActionExecutor";
import type { CurrentBranchCommandMapper } from "./CurrentBranchCommandMapper";
import type {
  CurrentBranchBuildAction,
  CurrentBranchOpenRequest,
  CurrentBranchResolutionResult
} from "./CurrentBranchCommandMapper";
import type { CurrentBranchJenkinsService } from "./CurrentBranchJenkinsService";
import type { CurrentBranchLinkWorkflowService } from "./CurrentBranchLinkWorkflowService";
import type {
  CurrentBranchEnvironmentDiscoveryResult,
  CurrentBranchLinkableEnvironment,
  CurrentBranchMultibranchDiscoveryResult,
  CurrentBranchMultibranchScanResult,
  CurrentBranchMultibranchTarget
} from "./CurrentBranchLinkWorkflowService";
import type {
  CurrentBranchRefreshOptions,
  CurrentBranchRepositoryInfo,
  CurrentBranchState
} from "./CurrentBranchTypes";

export type {
  CurrentBranchOpenRequest,
  CurrentBranchResolutionResult
} from "./CurrentBranchCommandMapper";
export type {
  CurrentBranchEnvironmentDiscoveryResult,
  CurrentBranchLinkableEnvironment,
  CurrentBranchMultibranchDiscoveryResult,
  CurrentBranchMultibranchScanResult,
  CurrentBranchMultibranchTarget
} from "./CurrentBranchLinkWorkflowService";

export class CurrentBranchWorkflowService {
  constructor(
    private readonly currentBranchService: CurrentBranchJenkinsService,
    private readonly linkWorkflowService: CurrentBranchLinkWorkflowService,
    private readonly commandMapper: CurrentBranchCommandMapper,
    private readonly actionExecutor: CurrentBranchActionExecutor
  ) {}

  listRepositories(): CurrentBranchRepositoryInfo[] | undefined {
    return this.currentBranchService.listRepositories();
  }

  listLinkableEnvironments(): Promise<CurrentBranchEnvironmentDiscoveryResult> {
    return this.linkWorkflowService.listLinkableEnvironments();
  }

  discoverMultibranchTargets(
    environment: CurrentBranchLinkableEnvironment["environment"]
  ): Promise<CurrentBranchMultibranchDiscoveryResult> {
    return this.linkWorkflowService.discoverMultibranchTargets(environment);
  }

  async linkRepository(
    repository: CurrentBranchRepositoryInfo,
    target: CurrentBranchMultibranchTarget
  ): Promise<void> {
    await this.linkWorkflowService.linkRepository(repository, target);
    await this.currentBranchService.refresh({ force: true });
  }

  async unlinkRepository(repository: CurrentBranchRepositoryInfo): Promise<boolean> {
    const removed = await this.linkWorkflowService.unlinkRepository(repository);
    await this.currentBranchService.refresh({ force: true });
    return removed;
  }

  async resolveCurrentBranchState(
    options: CurrentBranchRefreshOptions = { force: true }
  ): Promise<CurrentBranchResolutionResult> {
    const state = await this.currentBranchService.refresh(options);
    return this.commandMapper.mapStateToResolution(
      state,
      state.kind === "ambiguousRepository"
        ? this.currentBranchService.listRepositories()
        : undefined
    );
  }

  async resolveCurrentBranchStateForRepository(
    repository: CurrentBranchRepositoryInfo,
    options: CurrentBranchRefreshOptions = { force: true }
  ): Promise<CurrentBranchResolutionResult> {
    const state = await this.currentBranchService.resolveForRepository(repository, options);
    return this.commandMapper.mapStateToResolution(state);
  }

  refreshCurrentBranchStatus(
    options: CurrentBranchRefreshOptions = { force: true }
  ): Promise<CurrentBranchState> {
    return this.currentBranchService.refresh(options);
  }

  getOpenBranchRequest(state: CurrentBranchState): CurrentBranchOpenRequest | undefined {
    return this.commandMapper.getOpenBranchRequest(state);
  }

  getOpenMultibranchRequest(state: CurrentBranchState): CurrentBranchOpenRequest | undefined {
    return this.commandMapper.getOpenMultibranchRequest(state);
  }

  async scanLinkedMultibranch(
    state: CurrentBranchState
  ): Promise<CurrentBranchMultibranchScanResult | undefined> {
    const result = await this.linkWorkflowService.scanLinkedMultibranch(state);
    if (!result) {
      return undefined;
    }

    this.actionExecutor.refreshEnvironment(result.environmentId);
    await this.currentBranchService.refresh({ force: true });
    return result;
  }

  async triggerCurrentBranchBuild(state: CurrentBranchState): Promise<void> {
    const target = this.commandMapper.getBuildTarget(state);
    if (!target) {
      this.showActionUnavailableMessage(state, "triggerBuild");
      return;
    }

    await this.actionExecutor.triggerBuild(target, {
      onQueuedBuildWaitSettled: () => this.currentBranchService.refresh({ force: true })
    });
  }

  async openLatestBuild(state: CurrentBranchState, extensionUri: vscode.Uri): Promise<void> {
    const target = this.commandMapper.getLatestBuildTarget(state);
    if (!target) {
      this.showActionUnavailableMessage(state, "openLatestBuild");
      return;
    }

    await this.actionExecutor.openLatestBuild(target, extensionUri);
  }

  async openLastFailedBuild(state: CurrentBranchState, extensionUri: vscode.Uri): Promise<void> {
    const target = this.commandMapper.getLastFailedBuildTarget(state);
    if (!target) {
      this.showActionUnavailableMessage(state, "openLastFailedBuild");
      return;
    }

    await this.actionExecutor.openLastFailedBuild(target, extensionUri);
  }

  private showActionUnavailableMessage(
    state: CurrentBranchState,
    action: CurrentBranchBuildAction
  ): void {
    const message = this.commandMapper.getActionUnavailableMessage(state, action);
    if (!message) {
      return;
    }

    if (message.severity === "warning") {
      void vscode.window.showWarningMessage(message.message);
      return;
    }

    void vscode.window.showInformationMessage(message.message);
  }
}
