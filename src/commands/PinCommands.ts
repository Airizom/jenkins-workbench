import * as vscode from "vscode";
import type { JenkinsPinStore } from "../storage/JenkinsPinStore";
import type { JobTreeItem, PipelineTreeItem } from "../tree/TreeItems";
import { pinJob, unpinJob } from "./pin/PinCommandHandlers";
import type { PinCommandRefreshHost } from "./pin/PinCommandTypes";

export function registerPinCommands(
  context: vscode.ExtensionContext,
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
      (item?: JobTreeItem | PipelineTreeItem) => unpinJob(pinStore, refreshHost, item)
    )
  );
}

export type { PinCommandRefreshHost };
