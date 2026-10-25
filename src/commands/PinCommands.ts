import * as vscode from "vscode";
import type { EnvironmentScopedRefreshHost } from "../extension/ExtensionRefreshHost";
import type { JenkinsDataService } from "../jenkins/JenkinsDataService";
import type { JenkinsPinStore } from "../storage/JenkinsPinStore";
import type { PinnedJobsFolderTreeItem } from "../tree/TreeItems";
import { type BulkCommandDependencies, createBulkCommandHandler } from "./BulkCommand";
import { removeMissingPins } from "./pin/PinCommandHandlers";

export function registerPinCommands(
  context: vscode.ExtensionContext,
  dataService: JenkinsDataService,
  pinStore: JenkinsPinStore,
  refreshHost: EnvironmentScopedRefreshHost,
  bulk: BulkCommandDependencies
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "jenkinsWorkbench.pinJob",
      createBulkCommandHandler(bulk, "pin")
    ),
    vscode.commands.registerCommand(
      "jenkinsWorkbench.unpinJob",
      createBulkCommandHandler(bulk, "unpin")
    ),
    vscode.commands.registerCommand(
      "jenkinsWorkbench.pinJob.single",
      createBulkCommandHandler(bulk, "pin", true)
    ),
    vscode.commands.registerCommand(
      "jenkinsWorkbench.unpinJob.single",
      createBulkCommandHandler(bulk, "unpin", true)
    ),
    vscode.commands.registerCommand(
      "jenkinsWorkbench.removeMissingPins",
      (item?: PinnedJobsFolderTreeItem) =>
        removeMissingPins(dataService, pinStore, refreshHost, item)
    )
  );
}
