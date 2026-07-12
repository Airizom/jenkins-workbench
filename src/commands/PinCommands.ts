import * as vscode from "vscode";
import type { EnvironmentScopedRefreshHost } from "../extension/ExtensionRefreshHost";
import type { JenkinsDataService } from "../jenkins/JenkinsDataService";
import type { JenkinsPinStore } from "../storage/JenkinsPinStore";
import type {
  JobTreeItem,
  PinnedJobsFolderTreeItem,
  PipelineTreeItem,
  StalePinnedJobTreeItem
} from "../tree/TreeItems";
import { pinJob, removeMissingPins, unpinJob } from "./pin/PinCommandHandlers";

export function registerPinCommands(
  context: vscode.ExtensionContext,
  dataService: JenkinsDataService,
  pinStore: JenkinsPinStore,
  refreshHost: EnvironmentScopedRefreshHost
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "jenkinsWorkbench.pinJob",
      (item?: JobTreeItem | PipelineTreeItem) => pinJob(pinStore, refreshHost, item)
    ),
    vscode.commands.registerCommand(
      "jenkinsWorkbench.unpinJob",
      (item?: JobTreeItem | PipelineTreeItem | StalePinnedJobTreeItem) =>
        unpinJob(pinStore, refreshHost, item)
    ),
    vscode.commands.registerCommand(
      "jenkinsWorkbench.removeMissingPins",
      (item?: PinnedJobsFolderTreeItem) =>
        removeMissingPins(dataService, pinStore, refreshHost, item)
    )
  );
}
