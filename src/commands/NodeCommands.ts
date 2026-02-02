import * as vscode from "vscode";
import type { JenkinsDataService } from "../jenkins/JenkinsDataService";
import type { NodeTreeItem } from "../tree/TreeItems";
import {
  bringNodeOnline,
  launchNodeAgent,
  showNodeDetails,
  takeNodeOffline
} from "./node/NodeCommandHandlers";
import type { NodeCommandRefreshHost, NodeCommandTarget } from "./node/NodeCommandTypes";

export function registerNodeCommands(
  context: vscode.ExtensionContext,
  dataService: JenkinsDataService,
  refreshHost: NodeCommandRefreshHost
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("jenkinsWorkbench.showNodeDetails", (item?: NodeTreeItem) =>
      showNodeDetails(dataService, refreshHost, context.extensionUri, item)
    ),
    vscode.commands.registerCommand(
      "jenkinsWorkbench.takeNodeOffline",
      (item?: NodeTreeItem | NodeCommandTarget) => takeNodeOffline(dataService, refreshHost, item)
    ),
    vscode.commands.registerCommand(
      "jenkinsWorkbench.bringNodeOnline",
      (item?: NodeTreeItem | NodeCommandTarget) =>
        bringNodeOnline(dataService, refreshHost, item)
    ),
    vscode.commands.registerCommand(
      "jenkinsWorkbench.launchNodeAgent",
      (item?: NodeTreeItem | NodeCommandTarget) =>
        launchNodeAgent(dataService, refreshHost, item)
    )
  );
}
