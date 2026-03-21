import * as vscode from "vscode";
import { type GitApi, getAttachedBranchName, getGitApi } from "../git/GitExtensionApi";
import { isUriInside, toRepositoryContext, toRepositoryInfo } from "./CurrentBranchRepositoryUtils";
import type {
  CurrentBranchRepositoryContext,
  CurrentBranchRepositoryInfo
} from "./CurrentBranchTypes";

export class CurrentBranchRepositoryResolver implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  private readonly subscriptions: vscode.Disposable[] = [];
  private readonly repositoryStateSubscriptions = new Map<string, vscode.Disposable>();
  private readonly repositoryUiSubscriptions = new Map<string, vscode.Disposable>();
  private readonly repositoryHeadNames = new Map<string, string | undefined>();
  private gitApi?: GitApi;

  readonly onDidChange = this.emitter.event;

  constructor() {
    this.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor(() => {
        this.emitter.fire();
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        this.emitter.fire();
      })
    );
  }

  async initialize(): Promise<void> {
    try {
      this.gitApi = await getGitApi();
    } catch {
      this.gitApi = undefined;
    }

    if (!this.gitApi) {
      return;
    }

    this.subscriptions.push(
      this.gitApi.onDidOpenRepository(() => {
        this.syncRepositoryStateSubscriptions();
        this.emitter.fire();
      }),
      this.gitApi.onDidCloseRepository(() => {
        this.syncRepositoryStateSubscriptions();
        this.emitter.fire();
      })
    );

    this.syncRepositoryStateSubscriptions();
  }

  dispose(): void {
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
    for (const subscription of this.repositoryStateSubscriptions.values()) {
      subscription.dispose();
    }
    this.repositoryStateSubscriptions.clear();
    for (const subscription of this.repositoryUiSubscriptions.values()) {
      subscription.dispose();
    }
    this.repositoryUiSubscriptions.clear();
    this.emitter.dispose();
  }

  listRepositories(): CurrentBranchRepositoryInfo[] | undefined {
    if (!this.gitApi) {
      return undefined;
    }

    return this.gitApi.repositories
      .map((repository) => toRepositoryInfo(toRepositoryContext(repository)))
      .sort((left, right) => left.repositoryLabel.localeCompare(right.repositoryLabel));
  }

  resolveRepositoryContext(
    repository: CurrentBranchRepositoryInfo
  ): CurrentBranchRepositoryContext | undefined {
    if (!this.gitApi) {
      return undefined;
    }

    const match = this.gitApi.repositories.find(
      (entry) => entry.rootUri.toString() === repository.repositoryUriString
    );
    return match ? toRepositoryContext(match) : undefined;
  }

  resolveActiveRepository(): CurrentBranchRepositoryContext | undefined {
    const repositories = this.gitApi?.repositories;
    if (!repositories || repositories.length === 0) {
      return undefined;
    }

    const activeEditor = vscode.window.activeTextEditor;
    const activeUri = activeEditor?.document.uri;
    if (activeUri) {
      const matching = repositories
        .filter((repository) => isUriInside(activeUri, repository.rootUri))
        .sort((left, right) => right.rootUri.fsPath.length - left.rootUri.fsPath.length);
      if (matching.length > 0) {
        return toRepositoryContext(matching[0]);
      }
    }

    const selectedRepository = repositories.find((repository) => repository.ui?.selected);
    if (selectedRepository) {
      return toRepositoryContext(selectedRepository);
    }

    if (repositories.length === 1) {
      return toRepositoryContext(repositories[0]);
    }

    return undefined;
  }

  getRepositoryCount(): number {
    return this.gitApi?.repositories.length ?? 0;
  }

  private syncRepositoryStateSubscriptions(): void {
    const gitApi = this.gitApi;
    if (!gitApi) {
      return;
    }

    const liveKeys = new Set(
      gitApi.repositories.map((repository) => repository.rootUri.toString())
    );

    for (const repository of gitApi.repositories) {
      const key = repository.rootUri.toString();
      if (!this.repositoryStateSubscriptions.has(key)) {
        this.repositoryHeadNames.set(key, getHeadName(repository));
        const subscription = repository.state.onDidChange(() => {
          const nextHeadName = getHeadName(repository);
          const previousHeadName = this.repositoryHeadNames.get(key);
          if (nextHeadName === previousHeadName) {
            return;
          }
          this.repositoryHeadNames.set(key, nextHeadName);
          this.emitter.fire();
        });
        this.repositoryStateSubscriptions.set(key, subscription);
      }

      if (!this.repositoryUiSubscriptions.has(key) && repository.ui?.onDidChange) {
        const subscription = repository.ui.onDidChange(() => {
          this.emitter.fire();
        });
        this.repositoryUiSubscriptions.set(key, subscription);
      }
    }

    for (const [key, subscription] of this.repositoryStateSubscriptions.entries()) {
      if (liveKeys.has(key)) {
        continue;
      }
      subscription.dispose();
      this.repositoryStateSubscriptions.delete(key);
      this.repositoryHeadNames.delete(key);
    }

    for (const [key, subscription] of this.repositoryUiSubscriptions.entries()) {
      if (liveKeys.has(key)) {
        continue;
      }
      subscription.dispose();
      this.repositoryUiSubscriptions.delete(key);
    }
  }
}

function getHeadName(repository: CurrentBranchRepositoryContext["repository"]): string | undefined {
  return getAttachedBranchName(repository.state.HEAD);
}
