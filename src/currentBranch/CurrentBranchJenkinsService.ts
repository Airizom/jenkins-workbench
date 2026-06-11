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

interface PendingRefresh {
  options: CurrentBranchRefreshOptions;
  promise: Promise<CurrentBranchState>;
  resolve: (state: CurrentBranchState) => void;
  reject: (error: unknown) => void;
}

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
  private activeRefreshPromise: Promise<CurrentBranchState> | undefined;
  private pendingRefresh: PendingRefresh | undefined;
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
    this.resolvePendingRefresh(this.currentState);
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
    if (this.isDisposed) {
      return this.currentState;
    }

    if (this.activeRefreshPromise) {
      return this.queuePendingRefresh(options);
    }

    return this.runRefresh(options);
  }

  private async runRefresh(options: CurrentBranchRefreshOptions): Promise<CurrentBranchState> {
    const refreshPromise = this.resolveRefresh(options);
    this.activeRefreshPromise = refreshPromise;
    try {
      return await refreshPromise;
    } finally {
      if (this.activeRefreshPromise === refreshPromise) {
        this.activeRefreshPromise = undefined;
      }
      this.startPendingRefresh();
    }
  }

  private async resolveRefresh(options: CurrentBranchRefreshOptions): Promise<CurrentBranchState> {
    if (this.isDisposed) {
      return this.currentState;
    }

    const sequence = ++this.refreshSequence;
    const localState = await this.resolveLocalState();
    if (this.isDisposed || sequence !== this.refreshSequence) {
      return this.currentState;
    }

    if (localState.kind !== "linked") {
      this.updateState(localState);
      return this.currentState;
    }

    const nextState = await this.statusResolver.resolve(localState, options);
    if (!this.isDisposed && sequence === this.refreshSequence) {
      this.updateState(nextState);
    }
    return this.currentState;
  }

  private queuePendingRefresh(options: CurrentBranchRefreshOptions): Promise<CurrentBranchState> {
    this.refreshSequence += 1;
    if (!this.pendingRefresh) {
      this.pendingRefresh = createPendingRefresh(options);
      return this.pendingRefresh.promise;
    }

    this.pendingRefresh.options = mergeRefreshOptions(this.pendingRefresh.options, options);
    return this.pendingRefresh.promise;
  }

  private startPendingRefresh(): void {
    const pending = this.pendingRefresh;
    if (!pending) {
      return;
    }

    this.pendingRefresh = undefined;
    if (this.isDisposed) {
      pending.resolve(this.currentState);
      return;
    }

    this.runRefresh(pending.options).then(pending.resolve, pending.reject);
  }

  private resolvePendingRefresh(state: CurrentBranchState): void {
    const pending = this.pendingRefresh;
    if (!pending) {
      return;
    }

    this.pendingRefresh = undefined;
    pending.resolve(state);
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

function createPendingRefresh(options: CurrentBranchRefreshOptions): PendingRefresh {
  let resolve!: (state: CurrentBranchState) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<CurrentBranchState>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return {
    options,
    promise,
    resolve,
    reject
  };
}

function mergeRefreshOptions(
  first: CurrentBranchRefreshOptions,
  second: CurrentBranchRefreshOptions
): CurrentBranchRefreshOptions {
  return {
    force: first.force || second.force
  };
}
