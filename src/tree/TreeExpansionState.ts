import type * as vscode from "vscode";
import type {
  TreeExpansionPath,
  TreeExpansionResolveResult,
  TreeExpansionResolver
} from "./TreeDataProvider";
import type { WorkbenchTreeElement } from "./TreeItems";

type TreeRevealOptions = {
  expand: boolean;
  focus: false;
  select: false;
};

type ResolvePathOutcome = {
  element?: WorkbenchTreeElement;
  wasPending: boolean;
};

const RESTORE_RETRY_LIMIT = 3;
const RESTORE_RETRY_TIMEOUT_MS = 4000;

export class TreeExpansionState implements vscode.Disposable {
  private readonly expandedPaths = new Map<string, TreeExpansionPath>();
  private readonly disposables: vscode.Disposable[] = [];
  private isRestoring = false;

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
    this.isRestoring = true;
    try {
      for (const path of sortedPaths) {
        const key = this.buildKey(path);
        this.expandedPaths.set(key, path);
        const outcome = await this.resolvePathWithRetry(path);
        if (!outcome.element) {
          if (!outcome.wasPending) {
            this.expandedPaths.delete(key);
          }
          continue;
        }
        try {
          await this.treeView.reveal(outcome.element, this.buildRevealOptions());
          this.expandedPaths.set(key, path);
        } catch {
          // Ignore reveal failures for missing/virtual elements.
          this.expandedPaths.delete(key);
        }
      }
    } finally {
      this.isRestoring = false;
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
    if (this.isRestoring) {
      return;
    }
    const path = await this.treeDataProvider.buildExpansionPath(element);
    if (!path) {
      return;
    }
    this.expandedPaths.set(this.buildKey(path), path);
  }

  private async trackCollapsed(element: WorkbenchTreeElement): Promise<void> {
    if (this.isRestoring) {
      return;
    }
    const path = await this.treeDataProvider.buildExpansionPath(element);
    if (!path) {
      return;
    }
    for (const [key, storedPath] of this.expandedPaths) {
      if (isPathPrefix(path, storedPath)) {
        this.expandedPaths.delete(key);
      }
    }
  }

  private async resolvePathWithRetry(path: TreeExpansionPath): Promise<ResolvePathOutcome> {
    let attempts = 0;
    let wasPending = false;
    while (attempts <= RESTORE_RETRY_LIMIT) {
      const result = await this.resolvePathOnce(path);
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

  private async resolvePathOnce(path: TreeExpansionPath): Promise<TreeExpansionResolveResult> {
    return await this.treeDataProvider.resolveExpansionPath(path);
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
