import * as vscode from "vscode";
import type { JenkinsStatusRefreshService } from "../services/JenkinsStatusRefreshService";
import type { JenkinsEnvironmentStore } from "../storage/JenkinsEnvironmentStore";
import type { CurrentBranchLinkResolver } from "./CurrentBranchLinkResolver";
import type { CurrentBranchRefreshCoordinator } from "./CurrentBranchRefreshCoordinator";
import type { CurrentBranchRepositoryResolver } from "./CurrentBranchRepositoryResolver";
import type { CurrentBranchStatusResolver } from "./CurrentBranchStatusResolver";
import type {
  CurrentBranchLinkedContext,
  CurrentBranchRefreshOptions,
  CurrentBranchRepositoryInfo,
  CurrentBranchState
} from "./CurrentBranchTypes";

export type {
  CurrentBranchBuildInfo,
  CurrentBranchRepositoryInfo,
  CurrentBranchState
} from "./CurrentBranchTypes";

export class CurrentBranchJenkinsService implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<CurrentBranchState>();
  private readonly subscriptions: vscode.Disposable[] = [];
  private currentState: CurrentBranchState = { kind: "noGit" };
  private refreshSequence = 0;
  private startPromise: Promise<void> | undefined;
  private isDisposed = false;

  readonly onDidChange = this.emitter.event;

  constructor(
    private readonly repositoryResolver: CurrentBranchRepositoryResolver,
    environmentStore: JenkinsEnvironmentStore,
    private readonly linkResolver: CurrentBranchLinkResolver,
    private readonly statusResolver: CurrentBranchStatusResolver,
    private readonly refreshCoordinator: CurrentBranchRefreshCoordinator,
    statusRefreshService: JenkinsStatusRefreshService
  ) {
    this.subscriptions.push(
      this.repositoryResolver,
      this.repositoryResolver.onDidChange(() => {
        this.scheduleRefresh();
      }),
      environmentStore.onDidChange(() => {
        this.scheduleRefresh({ force: true });
      }),
      this.linkResolver.onDidChange(() => {
        this.scheduleRefresh();
      }),
      statusRefreshService.onDidTick(() => {
        if (!shouldRefreshFromStatusTick(this.currentState)) {
          return;
        }
        this.scheduleRefresh({ force: true });
      })
    );
  }

  start(): Promise<void> {
    if (!this.startPromise) {
      this.startPromise = this.initialize();
    }
    return this.startPromise;
  }

  dispose(): void {
    this.isDisposed = true;
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
    this.refreshCoordinator.dispose();
    this.statusResolver.dispose();
    this.emitter.dispose();
  }

  getState(): CurrentBranchState {
    return this.currentState;
  }

  listRepositories(): CurrentBranchRepositoryInfo[] | undefined {
    return this.repositoryResolver.listRepositories();
  }

  private async initialize(): Promise<void> {
    await this.repositoryResolver.initialize();
    if (this.isDisposed) {
      return;
    }
    await this.refresh({ force: false });
  }

  async refresh(options: CurrentBranchRefreshOptions = {}): Promise<CurrentBranchState> {
    this.refreshCoordinator.beginRefresh();

    const sequence = ++this.refreshSequence;
    const localState = await this.resolveLocalState();
    if (sequence !== this.refreshSequence) {
      return this.currentState;
    }

    if (localState.kind !== "linked") {
      this.updateState(localState);
      return this.currentState;
    }

    const nextState = await this.statusResolver.resolve(localState, options);
    if (sequence === this.refreshSequence) {
      this.updateState(nextState);
    }
    return this.currentState;
  }

  async resolveForRepository(
    repository: CurrentBranchRepositoryInfo,
    options: CurrentBranchRefreshOptions = {}
  ): Promise<CurrentBranchState> {
    const repositoryContext = this.repositoryResolver.resolveRepositoryContext(repository);
    if (!repositoryContext) {
      return { kind: "noRepository" };
    }

    const localState = await this.linkResolver.resolve(repositoryContext);
    if (localState.kind !== "linked") {
      return localState;
    }

    return this.statusResolver.resolve(localState, options);
  }

  private scheduleRefresh(options: CurrentBranchRefreshOptions = {}): void {
    this.refreshCoordinator.scheduleRefresh(options, (refreshOptions) => {
      void this.refresh(refreshOptions);
    });
  }

  private async resolveLocalState(): Promise<CurrentBranchState | CurrentBranchLinkedContext> {
    const repositories = this.repositoryResolver.listRepositories();
    if (!repositories) {
      return { kind: "noGit" };
    }

    const repository = this.repositoryResolver.resolveActiveRepository();
    if (!repository) {
      return repositories.length > 1 ? { kind: "ambiguousRepository" } : { kind: "noRepository" };
    }

    return this.linkResolver.resolve(repository);
  }

  private updateState(state: CurrentBranchState): void {
    this.currentState = state;
    this.emitter.fire(state);
  }
}

function shouldRefreshFromStatusTick(state: CurrentBranchState): boolean {
  return (
    state.kind === "matched" || state.kind === "branchMissing" || state.kind === "requestFailed"
  );
}
