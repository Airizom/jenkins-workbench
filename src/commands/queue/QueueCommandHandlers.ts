import * as vscode from "vscode";
import type { JenkinsDataService } from "../../jenkins/JenkinsDataService";
import type { QueueItemTreeItem } from "../../tree/TreeItems";
import { getTreeItemLabel, requireSelection, withActionErrorMessage } from "../CommandUtils";
import type { QueueCommandRefreshHost } from "./QueueCommandTypes";

export async function cancelQueueItem(
  dataService: JenkinsDataService,
  refreshHost: QueueCommandRefreshHost,
  item?: QueueItemTreeItem
): Promise<void> {
  const selected = requireSelection(item, "Select a queued item to cancel.");
  if (!selected) {
    return;
  }

  const label = getTreeItemLabel(selected);
  const confirmLabel = "Cancel Item";
  const confirmation = await vscode.window.showWarningMessage(
    `Cancel the queued item ${label}?`,
    { modal: true },
    confirmLabel
  );
  if (confirmation !== confirmLabel) {
    return;
  }

  await withActionErrorMessage(`Failed to cancel ${label}`, async () => {
    await dataService.cancelQueueItem(selected.environment, selected.queueId);
    void vscode.window.showInformationMessage(`Cancelled ${label}.`);
    refreshHost.fullEnvironmentRefresh({ environmentId: selected.environment.environmentId });
  });
}
