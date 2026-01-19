import * as vscode from "vscode";
import type { JenkinsDataService } from "../../jenkins/JenkinsDataService";
import { NodeDetailsPanel } from "../../panels/NodeDetailsPanel";
import type { NodeTreeItem } from "../../tree/TreeItems";
import { formatActionError, getTreeItemLabel } from "../CommandUtils";

export async function showNodeDetails(
  dataService: JenkinsDataService,
  extensionUri: vscode.Uri,
  item?: NodeTreeItem
): Promise<void> {
  if (!item) {
    void vscode.window.showInformationMessage("Select a node to view details.");
    return;
  }
  if (!item.nodeUrl) {
    void vscode.window.showInformationMessage(
      "That node does not expose a stable URL in the Jenkins API."
    );
    return;
  }

  try {
    await NodeDetailsPanel.show(
      dataService,
      item.environment,
      item.nodeUrl,
      extensionUri,
      getTreeItemLabel(item)
    );
  } catch (error) {
    void vscode.window.showErrorMessage(
      `Unable to open node details: ${formatActionError(error)}`
    );
  }
}
