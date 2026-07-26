import type * as vscode from "vscode";
import type { WorkbenchTreeElement } from "./items/WorkbenchTreeElement";
import type { TreeExpansionPath, TreeExpansionResolver } from "./TreeDataProviderTypes";

type TreeRevealOptions = {
  expand: boolean;
  focus: false;
  select: false;
};

type ResolvePathOutcome = {
  element?: WorkbenchTreeElement;
  wasPending: boolean;
};

type ExpansionOperation = {
  operationVersion: number;
  path?: TreeExpansionPath;
};

type CollapsedPathOperation = {
  operationVersion: number;
  path: TreeExpansionPath;
};

const RESTORE_RETRY_LIMIT = 3;
const RESTORE_RETRY_TIMEOUT_MS = 4000;

export class TreeExpansionState implements vscode.Disposable {
  private readonly expandedPaths = new Map<string, TreeExpansionPath>();
  private readonly expandedPathVersions = new Map<string, number>();
  private readonly collapsedPathOperations = new Map<string, CollapsedPathOperation>();
  private readonly elementOperationVersions = new WeakMap<WorkbenchTreeElement, number>();
  private readonly activeProgrammaticReveals = new WeakMap<WorkbenchTreeElement, number>();
  private readonly disposables: vscode.Disposable[] = [];
  private nextOperationVersion = 0;

  constructor(
    private readonly treeView: vscode.TreeView<WorkbenchTreeElement>,
    private readonly treeDataProvider: TreeExpansionResolver
  ) {
    this.disposables.push(
      treeView.onDidExpandElement((event) => {
        void this.trackExpanded(event.element);
      }),
      treeView.onDidCollapseElement((event) => {
        void this.trackCollapsed(event.element);
      })
    );
  }

  dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables.length = 0;
  }

  snapshot(): TreeExpansionPath[] {
    return Array.from(this.expandedPaths.values()).map((path) => [...path]);
  }

  async restore(paths: TreeExpansionPath[]): Promise<void> {
    if (paths.length === 0) {
      return;
    }

    const sortedPaths = [...paths].sort((left, right) => left.length - right.length);
    const operationVersion = ++this.nextOperationVersion;
    for (const path of sortedPaths) {
      const key = this.buildKey(path);
      const currentVersion = this.expandedPathVersions.get(key) ?? 0;
      if (
        currentVersion > operationVersion ||
        this.hasNewerCollapsedPrefix(path, operationVersion)
      ) {
        continue;
      }
      this.expandedPaths.set(key, path);
      this.expandedPathVersions.set(key, operationVersion);
      const outcome = await this.resolvePathWithRetry(path);
      if (!outcome.element) {
        if (!outcome.wasPending) {
          this.clearRestoredPath(key, operationVersion);
        }
        continue;
      }
      if (this.expandedPathVersions.get(key) !== operationVersion) {
        continue;
      }
      try {
        await this.revealForRestore(outcome.element);
      } catch {
        // Ignore reveal failures for missing/virtual elements.
        this.clearRestoredPath(key, operationVersion);
      }
    }
  }

  private buildRevealOptions(): TreeRevealOptions {
    return {
      expand: true,
      focus: false,
      select: false
    };
  }

  private async trackExpanded(element: WorkbenchTreeElement): Promise<void> {
    if (this.activeProgrammaticReveals.has(element)) {
      return;
    }
    const operation = await this.startExpansionOperation(element);
    if (
      !operation?.path ||
      this.hasNewerCollapsedPrefix(operation.path, operation.operationVersion)
    ) {
      return;
    }
    const key = this.buildKey(operation.path);
    this.expandedPaths.set(key, operation.path);
    this.expandedPathVersions.set(key, operation.operationVersion);
  }

  private async trackCollapsed(element: WorkbenchTreeElement): Promise<void> {
    const operation = await this.startExpansionOperation(element);
    if (!operation?.path) {
      return;
    }
    this.collapsedPathOperations.set(this.buildKey(operation.path), {
      operationVersion: operation.operationVersion,
      path: [...operation.path]
    });
    for (const [key, storedPath] of this.expandedPaths) {
      const expandedVersion = this.expandedPathVersions.get(key) ?? 0;
      if (
        expandedVersion < operation.operationVersion &&
        isPathPrefix(operation.path, storedPath)
      ) {
        this.expandedPaths.delete(key);
        this.expandedPathVersions.delete(key);
      }
    }
  }

  private startElementOperation(element: WorkbenchTreeElement): number {
    const operationVersion = ++this.nextOperationVersion;
    this.elementOperationVersions.set(element, operationVersion);
    return operationVersion;
  }

  private async startExpansionOperation(
    element: WorkbenchTreeElement
  ): Promise<ExpansionOperation> {
    const operationVersion = this.startElementOperation(element);
    return {
      operationVersion,
      path: await this.buildCurrentExpansionPath(element, operationVersion)
    };
  }

  private async revealForRestore(element: WorkbenchTreeElement): Promise<void> {
    const activeRevealCount = this.activeProgrammaticReveals.get(element) ?? 0;
    this.activeProgrammaticReveals.set(element, activeRevealCount + 1);
    try {
      await this.treeView.reveal(element, this.buildRevealOptions());
    } finally {
      const remainingRevealCount = (this.activeProgrammaticReveals.get(element) ?? 1) - 1;
      if (remainingRevealCount === 0) {
        this.activeProgrammaticReveals.delete(element);
      } else {
        this.activeProgrammaticReveals.set(element, remainingRevealCount);
      }
    }
  }

  private clearRestoredPath(key: string, operationVersion: number): void {
    if (this.expandedPathVersions.get(key) !== operationVersion) {
      return;
    }
    this.expandedPaths.delete(key);
    this.expandedPathVersions.delete(key);
  }

  private async buildCurrentExpansionPath(
    element: WorkbenchTreeElement,
    operationVersion: number
  ): Promise<TreeExpansionPath | undefined> {
    const path = await this.treeDataProvider.buildExpansionPath(element);
    if (!path || !this.isCurrentElementOperation(element, operationVersion)) {
      return undefined;
    }
    return path;
  }

  private isCurrentElementOperation(
    element: WorkbenchTreeElement,
    operationVersion: number
  ): boolean {
    return this.elementOperationVersions.get(element) === operationVersion;
  }

  private hasNewerCollapsedPrefix(path: TreeExpansionPath, operationVersion: number): boolean {
    for (const collapsed of this.collapsedPathOperations.values()) {
      if (collapsed.operationVersion > operationVersion && isPathPrefix(collapsed.path, path)) {
        return true;
      }
    }
    return false;
  }

  private async resolvePathWithRetry(path: TreeExpansionPath): Promise<ResolvePathOutcome> {
    let attempts = 0;
    let wasPending = false;
    while (attempts <= RESTORE_RETRY_LIMIT) {
      const result = await this.treeDataProvider.resolveExpansionPath(path);
      if (result.element) {
        return { element: result.element, wasPending };
      }
      if (!result.pending) {
        return { element: undefined, wasPending: false };
      }
      wasPending = true;
      attempts += 1;
      const didChange = await this.waitForTreeChange(RESTORE_RETRY_TIMEOUT_MS);
      if (!didChange) {
        return { element: undefined, wasPending: true };
      }
    }
    return { element: undefined, wasPending: true };
  }

  private buildKey(path: TreeExpansionPath): string {
    return JSON.stringify(path);
  }

  private async waitForTreeChange(timeoutMs: number): Promise<boolean> {
    return await new Promise<boolean>((resolve) => {
      let done = false;
      const disposable = this.treeDataProvider.onDidChangeTreeData(() => {
        if (done) {
          return;
        }
        done = true;
        disposable.dispose();
        clearTimeout(timer);
        resolve(true);
      });

      const timer = setTimeout(() => {
        if (done) {
          return;
        }
        done = true;
        disposable.dispose();
        resolve(false);
      }, timeoutMs);
    });
  }
}

function isPathPrefix(prefix: TreeExpansionPath, candidate: TreeExpansionPath): boolean {
  if (prefix.length > candidate.length) {
    return false;
  }
  for (let i = 0; i < prefix.length; i += 1) {
    if (prefix[i] !== candidate[i]) {
      return false;
    }
  }
  return true;
}
