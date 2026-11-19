import type * as vscode from "vscode";
import type { BuildCompletionTracker } from "../services/buildFollow/BuildCompletionTracker";
import { BuildTreeItem } from "./items/TreeBuildItems";
import { QueueItemTreeItem } from "./items/TreeQueueItems";
import type { WorkbenchTreeElement } from "./items/WorkbenchTreeElement";

type FollowRow = BuildTreeItem | QueueItemTreeItem;
export type TreeBuildFollowState = Pick<
  BuildCompletionTracker,
  "onDidChange" | "getObservedBuildState" | "isFollowingQueueItem"
>;

type FollowState = ReturnType<TreeBuildFollowState["getObservedBuildState"]>;

function isFollowRow(item: WorkbenchTreeElement): item is FollowRow {
  return (item instanceof BuildTreeItem && item.isBuilding) || item instanceof QueueItemTreeItem;
}

export class TreeBuildFollowPresentation implements vscode.Disposable {
  // VS Code refreshes rows by object identity. Keep each rendered copy, including Pinned and Activity.
  private readonly rowsByParent = new Map<string, Map<FollowRow, FollowState>>();
  private subscription?: vscode.Disposable;

  constructor(
    private readonly tracker: TreeBuildFollowState,
    private readonly notifyRow: (item: FollowRow) => void
  ) {}

  trackChildren(parent: WorkbenchTreeElement | undefined, children: WorkbenchTreeElement[]): void {
    if (!parent) {
      this.rowsByParent.clear();
      return;
    }
    if (!parent.id) {
      return;
    }
    const rows = children.filter(isFollowRow);
    if (rows.length === 0) {
      this.rowsByParent.delete(parent.id);
      return;
    }
    // The tracker and downstream subscriptions remain lazy until a followable row is displayed.
    this.subscription ??= this.tracker.onDidChange(() => this.refreshChangedRows());
    this.rowsByParent.set(
      parent.id,
      new Map(rows.map((item) => [item, this.getFollowState(item)]))
    );
  }

  getTreeItem(item: WorkbenchTreeElement): vscode.TreeItem {
    if (!isFollowRow(item)) return item;
    const state = this.getFollowState(item);
    if (state === "available") return item;
    const token = state === "following" ? "followed" : "followUnavailable";
    return { ...item, contextValue: `${item.contextValue} ${token}` };
  }

  dispose(): void {
    this.subscription?.dispose();
    this.rowsByParent.clear();
  }

  private getFollowState(item: FollowRow): FollowState {
    if (item instanceof QueueItemTreeItem) {
      return this.tracker.isFollowingQueueItem(item.environment, item.queueId)
        ? "following"
        : "available";
    }
    return item.followTarget ? this.tracker.getObservedBuildState(item.followTarget) : "conflict";
  }

  private refreshChangedRows(): void {
    for (const rows of this.rowsByParent.values()) {
      for (const [row, previous] of rows) {
        const state = this.getFollowState(row);
        if (state !== previous) {
          rows.set(row, state);
          this.notifyRow(row);
        }
      }
    }
  }
}
