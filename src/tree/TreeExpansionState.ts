import * as vscode from "vscode";
import type { WorkbenchTreeElement } from "./items/WorkbenchTreeElement";
import { retryOnTreeChange } from "./TreeChangeRetry";
import type { TreeExpansionPath, TreeExpansionResolver } from "./TreeDataProviderTypes";

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
  element: WorkbenchTreeElement;
};

export class TreeExpansionState implements vscode.Disposable {
  private readonly expandedPaths = new Map<string, TreeExpansionPath>();
  private readonly expandedPathVersions = new Map<string, number>();
  private readonly collapsedPathOperations = new Map<string, CollapsedPathOperation>();
  private readonly pendingCollapsedElements = new Map<WorkbenchTreeElement, number>();
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
      if (
        this.expandedPathVersions.get(key) !== operationVersion ||
        this.hasNewerCollapse(path, operationVersion, outcome.element)
      ) {
        this.clearRestoredPath(key, operationVersion);
        continue;
      }
      try {
        await this.revealForRestore(outcome.element);
        const collapsedElement = this.findNewerCollapsedElement(
          path,
          operationVersion,
          outcome.element
        );
        if (collapsedElement) {
          this.clearRestoredPath(key, operationVersion);
          await this.collapseRestoredElement(collapsedElement);
        }
      } catch {
        // Ignore reveal failures for missing/virtual elements.
        this.clearRestoredPath(key, operationVersion);
      }
    }
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
    const operationVersion = this.startElementOperation(element);
    this.pendingCollapsedElements.set(element, operationVersion);
    if (typeof element.id === "string") {
      for (const [key, storedPath] of this.expandedPaths) {
        if (storedPath.includes(element.id)) {
          this.expandedPaths.delete(key);
          this.expandedPathVersions.delete(key);
        }
      }
    }
    try {
      const path = await this.buildCurrentExpansionPath(element, operationVersion);
      if (!path) {
        return;
      }
      this.collapsedPathOperations.set(this.buildKey(path), {
        operationVersion,
        path: [...path],
        element
      });
      for (const [key, storedPath] of this.expandedPaths) {
        const expandedVersion = this.expandedPathVersions.get(key) ?? 0;
        if (expandedVersion < operationVersion && isPathPrefix(path, storedPath)) {
          this.expandedPaths.delete(key);
          this.expandedPathVersions.delete(key);
        }
      }
    } finally {
      if (this.pendingCollapsedElements.get(element) === operationVersion) {
        this.pendingCollapsedElements.delete(element);
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
      await this.treeView.reveal(element, {
        expand: true,
        focus: false,
        select: false
      });
    } finally {
      const remainingRevealCount = (this.activeProgrammaticReveals.get(element) ?? 1) - 1;
      if (remainingRevealCount === 0) {
        this.activeProgrammaticReveals.delete(element);
      } else {
        this.activeProgrammaticReveals.set(element, remainingRevealCount);
      }
    }
  }

  private async collapseRestoredElement(element: WorkbenchTreeElement): Promise<void> {
    await this.treeView.reveal(element, { expand: false, focus: true, select: true });
    await vscode.commands.executeCommand("list.collapse");
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

  private hasNewerCollapse(
    path: TreeExpansionPath,
    operationVersion: number,
    element: WorkbenchTreeElement
  ): boolean {
    return this.findNewerCollapsedElement(path, operationVersion, element) !== undefined;
  }

  private findNewerCollapsedElement(
    path: TreeExpansionPath,
    operationVersion: number,
    element: WorkbenchTreeElement
  ): WorkbenchTreeElement | undefined {
    let target: WorkbenchTreeElement | undefined;
    let shallowestDepth = path.length;
    for (const collapsed of this.collapsedPathOperations.values()) {
      if (collapsed.operationVersion <= operationVersion || !isPathPrefix(collapsed.path, path)) {
        continue;
      }
      const depth = collapsed.path.length - 1;
      if (depth < shallowestDepth) {
        target = collapsed.element;
        shallowestDepth = depth;
      }
    }
    for (const [collapsedElement, collapsedVersion] of this.pendingCollapsedElements) {
      if (collapsedVersion <= operationVersion) {
        continue;
      }
      const depth =
        typeof collapsedElement.id === "string"
          ? path.indexOf(collapsedElement.id)
          : collapsedElement === element
            ? path.length - 1
            : -1;
      if (depth >= 0 && depth < shallowestDepth) {
        target = collapsedElement;
        shallowestDepth = depth;
      }
    }
    return target;
  }

  private async resolvePathWithRetry(path: TreeExpansionPath): Promise<ResolvePathOutcome> {
    const result = await retryOnTreeChange({
      operation: () => this.treeDataProvider.resolveExpansionPath(path),
      onDidChangeTreeData: this.treeDataProvider.onDidChangeTreeData,
      shouldRetry: (attempt) => !attempt.element && attempt.pending,
      getPendingElement: (attempt) => attempt.pendingElement,
      waitAfterRetryExhausted: true
    });
    return { element: result.element, wasPending: result.pending };
  }

  private buildKey(path: TreeExpansionPath): string {
    return JSON.stringify(path);
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
