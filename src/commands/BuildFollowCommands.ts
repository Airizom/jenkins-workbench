import * as vscode from "vscode";
import type { BuildCompletionTracker } from "../services/buildFollow/BuildCompletionTracker";
import { BuildTreeItem, QueueItemTreeItem } from "../tree/TreeItems";
import { getTreeItemLabel } from "./CommandUtils";

type TreeFollowTracker = Pick<
  BuildCompletionTracker,
  | "follow"
  | "followQueueItem"
  | "getObservedBuildState"
  | "stopFollowingObservedBuild"
  | "stopFollowingQueueItem"
  | "showFollowedBuilds"
>;

export function registerBuildFollowCommands(
  context: vscode.ExtensionContext,
  tracker: TreeFollowTracker
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("jenkinsWorkbench.followBuild", (item?: BuildTreeItem) => {
      if (item instanceof BuildTreeItem && item.isBuilding) {
        const target = item.followTarget;
        if (!target) {
          void vscode.window.showWarningMessage(
            `Unable to follow build #${item.buildNumber}: Jenkins did not identify a followable build on this controller.`
          );
          return;
        }
        // This is a cached job-list observation. The tracker polls the Run itself for current status.
        if (tracker.getObservedBuildState(target) === "available")
          tracker.follow(target, "configured");
      }
    }),
    vscode.commands.registerCommand(
      "jenkinsWorkbench.followQueueItem",
      (item?: QueueItemTreeItem) => {
        if (item instanceof QueueItemTreeItem) {
          const { environment, queueId, taskUrl } = item;
          tracker.followQueueItem({ environment, queueId, taskUrl, label: getTreeItemLabel(item) });
        }
      }
    ),
    vscode.commands.registerCommand(
      "jenkinsWorkbench.stopFollowing",
      (item?: BuildTreeItem | QueueItemTreeItem) => {
        if (item instanceof BuildTreeItem) {
          if (item.followTarget) tracker.stopFollowingObservedBuild(item.followTarget);
        } else if (item instanceof QueueItemTreeItem) {
          tracker.stopFollowingQueueItem(item.environment, item.queueId);
        }
      }
    ),
    vscode.commands.registerCommand("jenkinsWorkbench.showFollowedBuilds", () =>
      tracker.showFollowedBuilds()
    )
  );
}
