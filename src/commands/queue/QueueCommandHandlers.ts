import * as vscode from "vscode";
import type { JenkinsDataService } from "../../jenkins/JenkinsDataService";
import type { QueueItemTreeItem } from "../../tree/TreeItems";
import { formatActionError, getTreeItemLabel } from "../CommandUtils";
import type { QueueCommandRefreshHost } from "./QueueCommandTypes";

export async function cancelQueueItem(
  dataService: JenkinsDataService,
  refreshHost: QueueCommandRefreshHost,
  item?: QueueItemTreeItem
): Promise<void> {
  if (!item) {
    void vscode.window.showInformationMessage("Select a queued item to cancel.");
    return;
  }

  const label = getTreeItemLabel(item);

  try {
    await dataService.cancelQueueItem(item.environment, item.queueId);
    void vscode.window.showInformationMessage(`Cancelled ${label}.`);
    refreshHost.refreshEnvironment(item.environment.environmentId);
  } catch (error) {
    void vscode.window.showErrorMessage(`Failed to cancel ${label}: ${formatActionError(error)}`);
  }
}
