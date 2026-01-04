import * as vscode from "vscode";
import type { JenkinsDataService } from "../jenkins/JenkinsDataService";
import type { QueueItemTreeItem } from "../tree/TreeItems";
import { cancelQueueItem } from "./queue/QueueCommandHandlers";
import type { QueueCommandRefreshHost } from "./queue/QueueCommandTypes";

export function registerQueueCommands(
  context: vscode.ExtensionContext,
  dataService: JenkinsDataService,
  refreshHost: QueueCommandRefreshHost
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "jenkinsWorkbench.cancelQueueItem",
      (item?: QueueItemTreeItem) => cancelQueueItem(dataService, refreshHost, item)
    )
  );
}

export type { QueueCommandRefreshHost };
