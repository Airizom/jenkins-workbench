import * as vscode from "vscode";
import type { JenkinsDataService } from "../../jenkins/JenkinsDataService";
import { NodeDetailsPanel } from "../../panels/NodeDetailsPanel";
import { NodeActionService, type NodeActionTarget } from "../../services/NodeActionService";
import { NodeTreeItem } from "../../tree/TreeItems";
import { getTreeItemLabel, requireSelection, withActionErrorMessage } from "../CommandUtils";
import type { NodeCommandRefreshHost, NodeCommandTarget } from "./NodeCommandTypes";

export async function showNodeDetails(
  dataService: JenkinsDataService,
  refreshHost: NodeCommandRefreshHost,
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
  const selected = requireSelection(item, `Select a node to ${actionLabel}.`);
  if (!selected) {
    return undefined;
  }

  if (!isNodeCommandTarget(selected)) {
    void vscode.window.showInformationMessage(`Select a node to ${actionLabel}.`);
    return undefined;
  }

  if (!selected.nodeUrl) {
    void vscode.window.showInformationMessage(
      "That node does not expose a stable URL in the Jenkins API."
    );
    return undefined;
  }

  if (selected instanceof NodeTreeItem) {
    return {
      label: getTreeItemLabel(selected),
      nodeUrl: selected.nodeUrl,
      environment: selected.environment
    };
  }

  return {
    label: selected.label?.trim() || selected.nodeUrl,
    nodeUrl: selected.nodeUrl,
    environment: selected.environment
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
