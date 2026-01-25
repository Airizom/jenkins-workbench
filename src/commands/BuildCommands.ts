import * as vscode from "vscode";
import type { JenkinsDataService } from "../jenkins/JenkinsDataService";
import type { PendingInputActionProvider } from "../panels/buildDetails/BuildDetailsPollingController";
import type { BuildConsoleExporter } from "../services/BuildConsoleExporter";
import type { QueuedBuildWaiter } from "../services/QueuedBuildWaiter";
import type {
  ArtifactTreeItem,
  BuildTreeItem,
  JobTreeItem,
  NodeTreeItem,
  PipelineTreeItem
} from "../tree/TreeItems";
import type { ArtifactActionHandler } from "../ui/ArtifactActionHandler";
import type { BuildLogPreviewer } from "../ui/BuildLogPreviewer";
import { downloadArtifact, previewArtifact } from "./build/BuildArtifactHandlers";
import {
  approveInput,
  openInJenkins,
  openLastFailedBuild,
  previewBuildLog,
  rebuildBuild,
  rejectInput,
  replayBuild,
  showBuildDetails,
  stopBuild,
  triggerBuild
} from "./build/BuildCommandHandlers";
import type { BuildCommandRefreshHost } from "./build/BuildCommandTypes";

export function registerBuildCommands(
  context: vscode.ExtensionContext,
  dataService: JenkinsDataService,
  artifactActionHandler: ArtifactActionHandler,
  buildLogPreviewer: BuildLogPreviewer,
  consoleExporter: BuildConsoleExporter,
  queuedBuildWaiter: QueuedBuildWaiter,
  pendingInputProvider: PendingInputActionProvider,
  refreshHost: BuildCommandRefreshHost
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "jenkinsWorkbench.triggerBuild",
      (item?: JobTreeItem | PipelineTreeItem) =>
        triggerBuild(dataService, queuedBuildWaiter, refreshHost, item)
    ),
    vscode.commands.registerCommand("jenkinsWorkbench.abortBuild", (item?: BuildTreeItem) =>
      stopBuild(dataService, refreshHost, item)
    ),
    vscode.commands.registerCommand("jenkinsWorkbench.approveInput", (item?: BuildTreeItem) =>
      approveInput(dataService, refreshHost, item)
    ),
    vscode.commands.registerCommand("jenkinsWorkbench.rejectInput", (item?: BuildTreeItem) =>
      rejectInput(dataService, refreshHost, item)
    ),
    vscode.commands.registerCommand("jenkinsWorkbench.replayBuild", (item?: BuildTreeItem) =>
      replayBuild(dataService, refreshHost, item)
    ),
    vscode.commands.registerCommand("jenkinsWorkbench.rebuildBuild", (item?: BuildTreeItem) =>
      rebuildBuild(dataService, refreshHost, item)
    ),
    vscode.commands.registerCommand(
      "jenkinsWorkbench.openInJenkins",
      (item?: JobTreeItem | PipelineTreeItem | BuildTreeItem | NodeTreeItem) => openInJenkins(item)
    ),
    vscode.commands.registerCommand("jenkinsWorkbench.showBuildDetails", (item?: BuildTreeItem) =>
      showBuildDetails(
        dataService,
        artifactActionHandler,
        consoleExporter,
        refreshHost,
        pendingInputProvider,
        context.extensionUri,
        item
      )
    ),
    vscode.commands.registerCommand(
      "jenkinsWorkbench.openLastFailedBuild",
      (item?: JobTreeItem | PipelineTreeItem) =>
        openLastFailedBuild(
          dataService,
          artifactActionHandler,
          consoleExporter,
          refreshHost,
          pendingInputProvider,
          context.extensionUri,
          item
        )
    ),
    vscode.commands.registerCommand("jenkinsWorkbench.previewBuildLog", (item?: BuildTreeItem) =>
      previewBuildLog(buildLogPreviewer, item)
    ),
    vscode.commands.registerCommand("jenkinsWorkbench.previewArtifact", (item?: ArtifactTreeItem) =>
      previewArtifact(artifactActionHandler, item)
    ),
    vscode.commands.registerCommand(
      "jenkinsWorkbench.downloadArtifact",
      (item?: ArtifactTreeItem) => downloadArtifact(artifactActionHandler, item)
    )
  );
}

export type { BuildCommandRefreshHost };
