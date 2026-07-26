import * as vscode from "vscode";
import type { EnvironmentScopedRefreshHost } from "../extension/ExtensionRefreshHost";
import type { JenkinsDataService } from "../jenkins/JenkinsDataService";
import type { NodeTreeItem } from "../tree/TreeItems";
import {
  bringNodeOnline,
  launchNodeAgent,
  showNodeDetails,
  takeNodeOffline
} from "./node/NodeCommandHandlers";

export function registerNodeCommands(
  context: vscode.ExtensionContext,
  dataService: JenkinsDataService,
  refreshHost: EnvironmentScopedRefreshHost
): void {
  context.subscriptions.push(
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
