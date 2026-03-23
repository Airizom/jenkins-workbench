import * as vscode from "vscode";
import type { JenkinsDataService } from "../jenkins/JenkinsDataService";
import type { JenkinsPinStore } from "../storage/JenkinsPinStore";
import type {
  JobTreeItem,
  PinnedJobsFolderTreeItem,
  PipelineTreeItem,
  StalePinnedJobTreeItem
} from "../tree/TreeItems";
import { pinJob, removeMissingPins, unpinJob } from "./pin/PinCommandHandlers";
import type { PinCommandRefreshHost } from "./pin/PinCommandTypes";

export function registerPinCommands(
  context: vscode.ExtensionContext,
  dataService: JenkinsDataService,
  pinStore: JenkinsPinStore,
  refreshHost: PinCommandRefreshHost
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

export type { PinCommandRefreshHost };
