import * as vscode from "vscode";
import type { JenkinsDataService } from "../../jenkins/JenkinsDataService";
import { NodeDetailsPanel } from "../../panels/NodeDetailsPanel";
import { NodeTreeItem } from "../../tree/TreeItems";
import { formatActionError, getTreeItemLabel } from "../CommandUtils";
import type { NodeCommandRefreshHost, NodeCommandTarget } from "./NodeCommandTypes";
import { NodeActionService, type NodeActionTarget } from "../../services/NodeActionService";

export async function showNodeDetails(
  dataService: JenkinsDataService,
  refreshHost: NodeCommandRefreshHost,
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
      getTreeItemLabel(item),
      refreshHost
    );
  } catch (error) {
    void vscode.window.showErrorMessage(`Unable to open node details: ${formatActionError(error)}`);
  }
}

export async function takeNodeOffline(
  dataService: JenkinsDataService,
  refreshHost: NodeCommandRefreshHost,
  item?: NodeTreeItem | NodeCommandTarget
): Promise<boolean> {
  const target = resolveNodeActionTarget(item, "take offline");
  if (!target) {
    return false;
  }
  const actionService = new NodeActionService(dataService);
  return actionService.takeNodeOffline(target, refreshHost);
}

export async function bringNodeOnline(
  dataService: JenkinsDataService,
  refreshHost: NodeCommandRefreshHost,
  item?: NodeTreeItem | NodeCommandTarget
): Promise<boolean> {
  const target = resolveNodeActionTarget(item, "bring online");
  if (!target) {
    return false;
  }
  const actionService = new NodeActionService(dataService);
  return actionService.bringNodeOnline(target, refreshHost);
}

export async function launchNodeAgent(
  dataService: JenkinsDataService,
  refreshHost: NodeCommandRefreshHost,
  item?: NodeTreeItem | NodeCommandTarget
): Promise<boolean> {
  const target = resolveNodeActionTarget(item, "launch agent");
  if (!target) {
    return false;
  }
  const actionService = new NodeActionService(dataService);
  return actionService.launchNodeAgent(target, refreshHost);
}

function resolveNodeActionTarget(
  item: NodeTreeItem | NodeCommandTarget | undefined,
  actionLabel: string
): NodeActionTarget | undefined {
  if (!item) {
    void vscode.window.showInformationMessage(`Select a node to ${actionLabel}.`);
    return undefined;
  }
  if (item instanceof NodeTreeItem) {
    if (!item.nodeUrl) {
      void vscode.window.showInformationMessage(
        "That node does not expose a stable URL in the Jenkins API."
      );
      return undefined;
    }
    return {
      label: getTreeItemLabel(item),
      nodeUrl: item.nodeUrl,
      environment: item.environment
    };
  }
  if (!isNodeCommandTarget(item)) {
    void vscode.window.showInformationMessage(`Select a node to ${actionLabel}.`);
    return undefined;
  }
  if (!item.nodeUrl) {
    void vscode.window.showInformationMessage(
      "That node does not expose a stable URL in the Jenkins API."
    );
    return undefined;
  }
  return {
    label: item.label?.trim() || item.nodeUrl,
    nodeUrl: item.nodeUrl,
    environment: item.environment
  };
}

function isNodeCommandTarget(value: unknown): value is NodeCommandTarget {
  if (!isRecord(value)) {
    return false;
  }
  const environment = value.environment;
  return (
    typeof value.nodeUrl === "string" &&
    isRecord(environment) &&
    typeof environment.environmentId === "string" &&
    typeof environment.url === "string" &&
    typeof environment.scope === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
