import * as vscode from "vscode";
import type { EnvironmentScopedRefreshHost } from "../extension/ExtensionRefreshHost";
import type { JenkinsDataService } from "../jenkins/JenkinsDataService";
import type { QueueItemTreeItem } from "../tree/TreeItems";
import { cancelQueueItem } from "./queue/QueueCommandHandlers";

export function registerQueueCommands(
  context: vscode.ExtensionContext,
  dataService: JenkinsDataService,
  refreshHost: EnvironmentScopedRefreshHost
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "jenkinsWorkbench.cancelQueueItem",
      (item?: QueueItemTreeItem) => cancelQueueItem(dataService, refreshHost, item)
    )
  );
}
