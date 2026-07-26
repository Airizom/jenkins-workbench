import * as vscode from "vscode";
import type { EnvironmentScopedRefreshHost } from "../../extension/ExtensionRefreshHost";
import type { JenkinsDataService } from "../../jenkins/JenkinsDataService";
import { NodeDetailsPanel } from "../../panels/NodeDetailsPanel";
import { NodeActionService, type NodeActionTarget } from "../../services/NodeActionService";
import { NodeTreeItem } from "../../tree/TreeItems";
import { getTreeItemLabel, requireSelection, withActionErrorMessage } from "../CommandUtils";

type NodeActionMethod = "takeNodeOffline" | "bringNodeOnline" | "launchNodeAgent";

export async function showNodeDetails(
  dataService: JenkinsDataService,
  refreshHost: EnvironmentScopedRefreshHost,
  extensionUri: vscode.Uri,
  item?: NodeTreeItem
): Promise<void> {
  const selected = requireSelection(item, "Select a node to view details.");
  if (!selected) {
    return;
  }
  if (!selected.nodeUrl) {
    void vscode.window.showInformationMessage(
      "That node does not expose a stable URL in the Jenkins API."
    );
    return;
  }
  const nodeUrl = selected.nodeUrl;

  await withActionErrorMessage("Unable to open node details", async () => {
    await NodeDetailsPanel.show({
      dataService,
      environment: selected.environment,
      nodeUrl,
      extensionUri,
      label: getTreeItemLabel(selected),
      refreshHost
    });
  });
}

export async function takeNodeOffline(
  dataService: JenkinsDataService,
  refreshHost: EnvironmentScopedRefreshHost,
  item?: NodeTreeItem
): Promise<boolean> {
  return runNodeAction(dataService, refreshHost, item, "take offline", "takeNodeOffline");
}

export async function bringNodeOnline(
  dataService: JenkinsDataService,
  refreshHost: EnvironmentScopedRefreshHost,
  item?: NodeTreeItem
): Promise<boolean> {
  return runNodeAction(dataService, refreshHost, item, "bring online", "bringNodeOnline");
}

export async function launchNodeAgent(
  dataService: JenkinsDataService,
  refreshHost: EnvironmentScopedRefreshHost,
  item?: NodeTreeItem
): Promise<boolean> {
  return runNodeAction(dataService, refreshHost, item, "launch agent", "launchNodeAgent");
}

async function runNodeAction(
  dataService: JenkinsDataService,
  refreshHost: EnvironmentScopedRefreshHost,
  item: NodeTreeItem | undefined,
  actionLabel: string,
  action: NodeActionMethod
): Promise<boolean> {
  const target = resolveNodeActionTarget(item, actionLabel);
  if (!target) {
    return false;
  }

  return new NodeActionService(dataService)[action](target, refreshHost);
}

function resolveNodeActionTarget(
  item: NodeTreeItem | undefined,
  actionLabel: string
): NodeActionTarget | undefined {
  const selected = requireSelection(item, `Select a node to ${actionLabel}.`);
  if (!selected) {
    return undefined;
  }

  if (!(selected instanceof NodeTreeItem)) {
    void vscode.window.showInformationMessage(`Select a node to ${actionLabel}.`);
    return undefined;
  }

  if (!selected.nodeUrl) {
    void vscode.window.showInformationMessage(
      "That node does not expose a stable URL in the Jenkins API."
    );
    return undefined;
  }
  return {
    label: getTreeItemLabel(selected),
    nodeUrl: selected.nodeUrl,
    environment: selected.environment
  };
}
