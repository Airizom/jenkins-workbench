import * as vscode from "vscode";
import type { EnvironmentScopedRefreshHost } from "../../extension/ExtensionRefreshHost";
import { formatEnvironmentDisplayName } from "../../jenkins/EnvironmentLabels";
import type { JenkinsDataService } from "../../jenkins/JenkinsDataService";
import { toJenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import { NodeDetailsPanel } from "../../panels/NodeDetailsPanel";
import { NodeActionService, type NodeActionTarget } from "../../services/NodeActionService";
import type { JenkinsEnvironmentStore } from "../../storage/JenkinsEnvironmentStore";
import { NodesFolderTreeItem, NodeTreeItem } from "../../tree/TreeItems";
import { getTreeItemLabel, requireSelection, withActionErrorMessage } from "../CommandUtils";

type NodeActionMethod =
  | "takeNodeOffline"
  | "bringNodeOnline"
  | "launchNodeAgent"
  | "editNodeLabels"
  | "disconnectNodeAgent"
  | "copyNode"
  | "deleteNode";

export async function showNodeDetails(
  dataService: JenkinsDataService,
  refreshHost: EnvironmentScopedRefreshHost,
  extensionUri: vscode.Uri,
  item?: NodeTreeItem,
  initialTab?: "agentLog"
): Promise<void> {
  const target = resolveNodeActionTarget(item, "view details");
  if (!target) {
    return;
  }

  await withActionErrorMessage("Unable to open node details", async () => {
    await NodeDetailsPanel.show({
      dataService,
      environment: target.environment,
      nodeUrl: target.nodeUrl,
      extensionUri,
      label: target.label,
      refreshHost,
      initialTab
    });
  });
}

export async function showNodeAgentLog(
  dataService: JenkinsDataService,
  refreshHost: EnvironmentScopedRefreshHost,
  extensionUri: vscode.Uri,
  item?: NodeTreeItem
): Promise<void> {
  await showNodeDetails(dataService, refreshHost, extensionUri, item, "agentLog");
}

export async function editNodeLabels(
  dataService: JenkinsDataService,
  refreshHost: EnvironmentScopedRefreshHost,
  item?: NodeTreeItem
): Promise<boolean> {
  return runNodeAction(dataService, refreshHost, item, "edit labels", "editNodeLabels");
}

export async function disconnectNodeAgent(
  dataService: JenkinsDataService,
  refreshHost: EnvironmentScopedRefreshHost,
  item?: NodeTreeItem
): Promise<boolean> {
  return runNodeAction(dataService, refreshHost, item, "disconnect", "disconnectNodeAgent");
}

export async function copyNode(
  dataService: JenkinsDataService,
  refreshHost: EnvironmentScopedRefreshHost,
  item?: NodeTreeItem
): Promise<boolean> {
  return runNodeAction(dataService, refreshHost, item, "copy", "copyNode");
}

export async function deleteNode(
  dataService: JenkinsDataService,
  refreshHost: EnvironmentScopedRefreshHost,
  item?: NodeTreeItem
): Promise<boolean> {
  return runNodeAction(dataService, refreshHost, item, "delete", "deleteNode");
}

export async function createNode(
  dataService: JenkinsDataService,
  environmentStore: JenkinsEnvironmentStore,
  refreshHost: EnvironmentScopedRefreshHost,
  extensionUri: vscode.Uri,
  item?: NodesFolderTreeItem
): Promise<void> {
  let environment = item instanceof NodesFolderTreeItem ? item.environment : undefined;
  if (!environment) {
    const environments = await environmentStore.listEnvironmentsWithScope();
    if (environments.length === 0) {
      void vscode.window.showInformationMessage(
        "Add a Jenkins environment before creating a node."
      );
      return;
    }
    const selected =
      environments.length === 1
        ? environments[0]
        : (
            await vscode.window.showQuickPick(
              environments.map((candidate) => ({
                label: formatEnvironmentDisplayName(candidate),
                description: candidate.scope,
                environment: candidate
              })),
              { title: "Create Node", placeHolder: "Select a Jenkins environment" }
            )
          )?.environment;
    if (!selected) {
      return;
    }
    environment = toJenkinsEnvironmentRef(selected);
  }
  await withActionErrorMessage("Unable to create node", async () => {
    const target = await new NodeActionService(dataService).createNode(environment, refreshHost);
    if (target) {
      await NodeDetailsPanel.show({
        dataService,
        environment: target.environment,
        nodeUrl: target.nodeUrl,
        extensionUri,
        label: target.label,
        refreshHost
      });
    }
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

  const succeeded = await new NodeActionService(dataService)[action](target, refreshHost);
  if (succeeded && action === "deleteNode") {
    NodeDetailsPanel.closeForNode(target.environment, target.nodeUrl);
  }
  return succeeded;
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
