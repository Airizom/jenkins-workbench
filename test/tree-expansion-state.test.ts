import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { TreeExpansionState } from "../src/tree/TreeExpansionState";
import type {
  TreeExpansionPath,
  TreeExpansionResolver,
  TreeExpansionResolveResult
} from "../src/tree/TreeDataProviderTypes";
import type { WorkbenchTreeElement } from "../src/tree/items/WorkbenchTreeElement";

type Disposable = { dispose(): void };
type TreeElementEvent = { element: WorkbenchTreeElement };
type TreeElementListener = (event: TreeElementEvent) => void;

class TestTreeView {
  private readonly expandListeners = new Set<TreeElementListener>();
  private readonly collapseListeners = new Set<TreeElementListener>();
  onReveal?: (element: WorkbenchTreeElement) => void;

  readonly onDidExpandElement = (listener: TreeElementListener): Disposable => {
    this.expandListeners.add(listener);
    return {
      dispose: () => {
        this.expandListeners.delete(listener);
      }
    };
  };

  readonly onDidCollapseElement = (listener: TreeElementListener): Disposable => {
    this.collapseListeners.add(listener);
    return {
      dispose: () => {
        this.collapseListeners.delete(listener);
      }
    };
  };

  async reveal(element: WorkbenchTreeElement): Promise<void> {
    this.onReveal?.(element);
  }

  fireExpand(element: WorkbenchTreeElement): void {
    for (const listener of this.expandListeners) {
      listener({ element });
    }
  }

  fireCollapse(element: WorkbenchTreeElement): void {
    for (const listener of this.collapseListeners) {
      listener({ element });
    }
  }
}

type PendingBuild = {
  readonly element: WorkbenchTreeElement;
  readonly resolve: (path: TreeExpansionPath | undefined) => void;
};

type PendingResolve = {
  readonly path: TreeExpansionPath;
  readonly resolve: (result: TreeExpansionResolveResult) => void;
};

class ControlledExpansionResolver implements TreeExpansionResolver {
  readonly pendingBuilds: PendingBuild[] = [];
  readonly pendingResolves: PendingResolve[] = [];

  readonly onDidChangeTreeData = (): Disposable => ({ dispose: () => undefined });

  async buildExpansionPath(element: WorkbenchTreeElement): Promise<TreeExpansionPath | undefined> {
    return await new Promise<TreeExpansionPath | undefined>((resolve) => {
      this.pendingBuilds.push({ element, resolve });
    });
  }

  async resolveExpansionPath(path: TreeExpansionPath): Promise<TreeExpansionResolveResult> {
    return await new Promise<TreeExpansionResolveResult>((resolve) => {
      this.pendingResolves.push({ path, resolve });
    });
  }
}

function createElement(): WorkbenchTreeElement {
  return {} as WorkbenchTreeElement;
}

async function flushPromises(): Promise<void> {
  for (let index = 0; index < 5; index += 1) {
    await Promise.resolve();
  }
}

describe("TreeExpansionState", () => {
  it("does not restore an expansion when a later collapse resolves first", async () => {
    const treeView = new TestTreeView();
    const resolver = new ControlledExpansionResolver();
    const state = new TreeExpansionState(
      treeView as unknown as ConstructorParameters<typeof TreeExpansionState>[0],
      resolver
    );
    const element = createElement();
    const path = ["env", "jobs", "folder"];

    treeView.fireExpand(element);
    treeView.fireCollapse(element);
    assert.equal(resolver.pendingBuilds.length, 2);

    resolver.pendingBuilds[1].resolve(path);
    await flushPromises();
    assert.deepEqual(state.snapshot(), []);

    resolver.pendingBuilds[0].resolve(path);
    await flushPromises();
    assert.deepEqual(state.snapshot(), []);

    state.dispose();
  });

  it("tracks user expansion and collapse events while a restore is resolving", async () => {
    const treeView = new TestTreeView();
    const resolver = new ControlledExpansionResolver();
    const state = new TreeExpansionState(
      treeView as unknown as ConstructorParameters<typeof TreeExpansionState>[0],
      resolver
    );
    const restoredElement = createElement();
    const userExpandedElement = createElement();
    const restoredPath = ["env", "jobs", "restored"];
    const userExpandedPath = ["env", "jobs", "user-expanded"];

    treeView.fireExpand(restoredElement);
    resolver.pendingBuilds[0].resolve(restoredPath);
    await flushPromises();

    const restore = state.restore([restoredPath]);
    assert.equal(resolver.pendingResolves.length, 1);

    treeView.fireCollapse(restoredElement);
    treeView.fireExpand(userExpandedElement);
    resolver.pendingBuilds[1].resolve(restoredPath);
    resolver.pendingBuilds[2].resolve(userExpandedPath);
    await flushPromises();
    assert.deepEqual(state.snapshot(), [userExpandedPath]);

    resolver.pendingResolves[0].resolve({ element: restoredElement, pending: false });
    await restore;
    assert.deepEqual(state.snapshot(), [userExpandedPath]);

    state.dispose();
  });

  it("preserves a user collapse during overlapping restores", async () => {
    const treeView = new TestTreeView();
    const resolver = new ControlledExpansionResolver();
    const state = new TreeExpansionState(
      treeView as unknown as ConstructorParameters<typeof TreeExpansionState>[0],
      resolver
    );
    const element = createElement();
    const path = ["env", "jobs", "folder"];

    const firstRestore = state.restore([path]);
    const secondRestore = state.restore([path]);
    assert.equal(resolver.pendingResolves.length, 2);

    treeView.fireCollapse(element);
    resolver.pendingBuilds[0].resolve(path);
    await flushPromises();

    resolver.pendingResolves[0].resolve({ element, pending: false });
    resolver.pendingResolves[1].resolve({ element, pending: false });
    await Promise.all([firstRestore, secondRestore]);
    assert.deepEqual(state.snapshot(), []);

    state.dispose();
  });

  it("suppresses only expansion events emitted by an active programmatic reveal", async () => {
    const treeView = new TestTreeView();
    const resolver = new ControlledExpansionResolver();
    const state = new TreeExpansionState(
      treeView as unknown as ConstructorParameters<typeof TreeExpansionState>[0],
      resolver
    );
    const element = createElement();
    const path = ["env", "jobs", "folder"];
    treeView.onReveal = (revealedElement) => treeView.fireExpand(revealedElement);

    const restore = state.restore([path]);
    resolver.pendingResolves[0].resolve({ element, pending: false });
    await restore;

    assert.equal(resolver.pendingBuilds.length, 0);
    assert.deepEqual(state.snapshot(), [path]);

    state.dispose();
  });
});
