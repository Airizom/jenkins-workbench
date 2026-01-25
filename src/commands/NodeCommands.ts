import * as vscode from "vscode";
import type { JenkinsDataService } from "../jenkins/JenkinsDataService";
import type { NodeTreeItem } from "../tree/TreeItems";
import { showNodeDetails } from "./node/NodeCommandHandlers";

export function registerNodeCommands(
  context: vscode.ExtensionContext,
  dataService: JenkinsDataService
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("jenkinsWorkbench.showNodeDetails", (item?: NodeTreeItem) =>
      showNodeDetails(dataService, context.extensionUri, item)
    )
  );
}
