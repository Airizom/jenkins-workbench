import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TreeExpansionState } from "../src/tree/TreeExpansionState";
import type { TreeExpansionPath, TreeExpansionResolver } from "../src/tree/TreeDataProviderTypes";
import type { WorkbenchTreeElement } from "../src/tree/items/WorkbenchTreeElement";

type Disposable = { dispose(): void };
type TreeElementEvent = { element: WorkbenchTreeElement };
type TreeElementListener = (event: TreeElementEvent) => void;

class TestTreeView {
  private readonly expandListeners = new Set<TreeElementListener>();
  private readonly collapseListeners = new Set<TreeElementListener>();

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

  async reveal(): Promise<void> {
    return;
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

class ControlledExpansionResolver implements TreeExpansionResolver {
  readonly pendingBuilds: PendingBuild[] = [];

  readonly onDidChangeTreeData = (): Disposable => ({ dispose: () => undefined });

  async buildExpansionPath(element: WorkbenchTreeElement): Promise<TreeExpansionPath | undefined> {
    return await new Promise<TreeExpansionPath | undefined>((resolve) => {
      this.pendingBuilds.push({ element, resolve });
    });
  }

  async resolveExpansionPath(): Promise<{ pending: false }> {
    return { pending: false };
  }
}

function createElement(): WorkbenchTreeElement {
  return {} as WorkbenchTreeElement;
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
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
});
