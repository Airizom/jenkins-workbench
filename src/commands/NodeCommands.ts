import * as vscode from "vscode";
import type { EnvironmentScopedRefreshHost } from "../extension/ExtensionRefreshHost";
import type { JenkinsDataService } from "../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentStore } from "../storage/JenkinsEnvironmentStore";
import type { NodesFolderTreeItem, NodeTreeItem } from "../tree/TreeItems";
import {
  bringNodeOnline,
  copyNode,
  createNode,
  deleteNode,
  disconnectNodeAgent,
  editNodeLabels,
  launchNodeAgent,
  showNodeAgentLog,
  showNodeDetails,
  takeNodeOffline
} from "./node/NodeCommandHandlers";

export function registerNodeCommands(
  context: vscode.ExtensionContext,
  dataService: JenkinsDataService,
  refreshHost: EnvironmentScopedRefreshHost,
  environmentStore: JenkinsEnvironmentStore
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("jenkinsWorkbench.createNode", (item?: NodesFolderTreeItem) =>
      createNode(dataService, environmentStore, refreshHost, context.extensionUri, item)
    ),
    vscode.commands.registerCommand("jenkinsWorkbench.editNodeLabels", (item?: NodeTreeItem) =>
      editNodeLabels(dataService, refreshHost, item)
    ),
    vscode.commands.registerCommand("jenkinsWorkbench.disconnectNodeAgent", (item?: NodeTreeItem) =>
      disconnectNodeAgent(dataService, refreshHost, item)
    ),
    vscode.commands.registerCommand("jenkinsWorkbench.copyNode", (item?: NodeTreeItem) =>
      copyNode(dataService, refreshHost, item)
    ),
    vscode.commands.registerCommand("jenkinsWorkbench.deleteNode", (item?: NodeTreeItem) =>
      deleteNode(dataService, refreshHost, item)
    ),
    vscode.commands.registerCommand("jenkinsWorkbench.showNodeAgentLog", (item?: NodeTreeItem) =>
      showNodeAgentLog(dataService, refreshHost, context.extensionUri, item)
    ),
    vscode.commands.registerCommand("jenkinsWorkbench.showNodeDetails", (item?: NodeTreeItem) =>
      showNodeDetails(dataService, refreshHost, context.extensionUri, item)
    ),
    vscode.commands.registerCommand("jenkinsWorkbench.takeNodeOffline", (item?: NodeTreeItem) =>
      takeNodeOffline(dataService, refreshHost, item)
    ),
    vscode.commands.registerCommand("jenkinsWorkbench.bringNodeOnline", (item?: NodeTreeItem) =>
      bringNodeOnline(dataService, refreshHost, item)
    ),
    vscode.commands.registerCommand("jenkinsWorkbench.launchNodeAgent", (item?: NodeTreeItem) =>
      launchNodeAgent(dataService, refreshHost, item)
    )
  );
}
