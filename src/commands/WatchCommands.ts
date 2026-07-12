import * as vscode from "vscode";
import type { EnvironmentScopedRefreshHost } from "../extension/ExtensionRefreshHost";
import type { JenkinsWatchStore } from "../storage/JenkinsWatchStore";
import type { JobTreeItem, PipelineTreeItem } from "../tree/TreeItems";
import { unwatchJob, watchJob } from "./watch/WatchCommandHandlers";

export function registerWatchCommands(
  context: vscode.ExtensionContext,
  watchStore: JenkinsWatchStore,
  refreshHost: EnvironmentScopedRefreshHost
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "jenkinsWorkbench.watchJob",
      (item?: JobTreeItem | PipelineTreeItem) => watchJob(watchStore, refreshHost, item)
    ),
    vscode.commands.registerCommand(
      "jenkinsWorkbench.unwatchJob",
      (item?: JobTreeItem | PipelineTreeItem) => unwatchJob(watchStore, refreshHost, item)
    )
  );
}

export type { EnvironmentScopedRefreshHost };
