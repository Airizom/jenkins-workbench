import * as vscode from "vscode";
import type { WorkbenchTreeElement } from "../../tree/TreeItems";
import { type BulkAction, isBulkActionEligible } from "./BulkActionTargets";

const CONTEXT_PREFIX = "jenkinsWorkbench.bulkSelection";
const ACTIONS: readonly BulkAction[] = ["stop", "cancel", "watch", "unwatch", "pin", "unpin"];

/** Routes tree menu arguments without making explicit single-item callers depend on selection. */
export class TreeBulkSelection implements vscode.Disposable {
  private readonly subscriptions: vscode.Disposable[] = [];
  private disposed = false;

  constructor(
    private readonly treeView: Pick<
      vscode.TreeView<WorkbenchTreeElement>,
      "selection" | "onDidChangeSelection"
    >,
    treeDataProvider: Pick<vscode.TreeDataProvider<WorkbenchTreeElement>, "onDidChangeTreeData">
  ) {
    this.subscriptions.push(treeView.onDidChangeSelection(() => this.updateContext()));
    if (treeDataProvider.onDidChangeTreeData) {
      this.subscriptions.push(treeDataProvider.onDidChangeTreeData(() => this.updateContext()));
    }
    this.updateContext();
  }

  resolve(
    item?: WorkbenchTreeElement,
    selection?: readonly WorkbenchTreeElement[]
  ): readonly WorkbenchTreeElement[] {
    if (!item) {
      return [...this.treeView.selection];
    }
    if (selection?.some((candidate) => sameTreeRow(candidate, item))) {
      return [...selection];
    }
    return [item];
  }

  dispose(): void {
    this.disposed = true;
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
    this.subscriptions.length = 0;
    this.updateContext();
  }

  private updateContext(): void {
    const selection = this.disposed ? [] : this.treeView.selection;
    const values: readonly [string, boolean][] = [
      [`${CONTEXT_PREFIX}.multiple`, selection.length > 1],
      ...ACTIONS.map((action): [string, boolean] => [
        `${CONTEXT_PREFIX}.${action}`,
        selection.some((item) => isBulkActionEligible(action, item))
      ])
    ];
    // VS Code may replace rows under the same selected handles after a refresh without
    // emitting a selection event. Keep bulk menus independent of mutable watch/pin state;
    // the action checks current stored state and reports items that are already unchanged.
    // Invoke updates together so newer selection events are sent after older events.
    void Promise.all(
      values.map(([key, value]) => vscode.commands.executeCommand("setContext", key, value))
    ).catch((error) => {
      console.warn("Failed to update Jenkins bulk-selection context.", error);
    });
  }
}

function sameTreeRow(left: WorkbenchTreeElement, right: WorkbenchTreeElement): boolean {
  return left === right || (left.id !== undefined && left.id === right.id);
}
