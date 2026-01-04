import * as vscode from "vscode";
import type { JenkinsDataService } from "../jenkins/JenkinsDataService";
import type { BuildTreeItem, JobTreeItem, PipelineTreeItem } from "../tree/TreeItems";
import {
  openInJenkins,
  openLastFailedBuild,
  rebuildBuild,
  replayBuild,
  showBuildDetails,
  stopBuild,
  triggerBuild
} from "./build/BuildCommandHandlers";
import type { BuildCommandRefreshHost } from "./build/BuildCommandTypes";

export function registerBuildCommands(
  context: vscode.ExtensionContext,
  dataService: JenkinsDataService,
  refreshHost: BuildCommandRefreshHost
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "jenkinsWorkbench.triggerBuild",
      (item?: JobTreeItem | PipelineTreeItem) => triggerBuild(dataService, refreshHost, item)
    ),
    vscode.commands.registerCommand("jenkinsWorkbench.abortBuild", (item?: BuildTreeItem) =>
      stopBuild(dataService, refreshHost, item)
    ),
    vscode.commands.registerCommand("jenkinsWorkbench.replayBuild", (item?: BuildTreeItem) =>
      replayBuild(dataService, refreshHost, item)
    ),
    vscode.commands.registerCommand("jenkinsWorkbench.rebuildBuild", (item?: BuildTreeItem) =>
      rebuildBuild(dataService, refreshHost, item)
    ),
    vscode.commands.registerCommand(
      "jenkinsWorkbench.openInJenkins",
      (item?: JobTreeItem | PipelineTreeItem | BuildTreeItem) => openInJenkins(item)
    ),
    vscode.commands.registerCommand("jenkinsWorkbench.showBuildDetails", (item?: BuildTreeItem) =>
      showBuildDetails(dataService, item)
    ),
    vscode.commands.registerCommand(
      "jenkinsWorkbench.openLastFailedBuild",
      (item?: JobTreeItem | PipelineTreeItem) => openLastFailedBuild(dataService, item)
    )
  );
}

export type { BuildCommandRefreshHost };
