import * as vscode from "vscode";
import type { JenkinsDataService } from "../jenkins/JenkinsDataService";
import type { BuildComparePanelLauncher } from "../panels/BuildComparePanelLauncher";
import type { BuildDetailsPanelLauncher } from "../panels/BuildDetailsPanelLauncher";
import type { BuildDescriptionDraftManager } from "../services/BuildDescriptionDraftManager";
import type { BuildManagementWorkflow } from "../services/build/BuildManagementWorkflow";
import type { QueuedBuildWaiter } from "../services/QueuedBuildWaiter";
import type { JenkinsParameterPresetStore } from "../storage/JenkinsParameterPresetStore";
import type {
  ArtifactTreeItem,
  BuildTreeItem,
  JobTreeItem,
  PipelineTreeItem
} from "../tree/TreeItems";
import type { ArtifactActionHandler } from "../ui/ArtifactActionHandler";
import type { BuildLogPreviewer } from "../ui/BuildLogPreviewer";
import { downloadArtifact, previewArtifact } from "./build/BuildArtifactHandlers";
import {
  approveInput,
  compareWithBuild,
  type OpenableTreeItem,
  openInJenkins,
  openLastFailedBuild,
  previewBuildLog,
  quickReplayBuild,
  rebuildBuild,
  rejectInput,
  replayBuild,
  runReplayDraft,
  showBuildDetails,
  stopBuild,
  triggerBuild
} from "./build/BuildCommandHandlers";
import type { BuildCommandRefreshHost } from "./build/BuildCommandTypes";
import {
  deleteBuild,
  editBuildDescription,
  editBuildDisplayName,
  keepBuildForever,
  stopKeepingBuild
} from "./build/BuildManagementHandlers";
import type { LocalJenkinsfileReplayWorkflow } from "./build/LocalJenkinsfileReplayWorkflow";
import type { ReplayBuildWorkflow } from "./build/ReplayBuildWorkflow";

export interface BuildManagementCommandDependencies {
  workflow: BuildManagementWorkflow;
  descriptionDraftManager: BuildDescriptionDraftManager;
}

export function registerBuildCommands(
  context: vscode.ExtensionContext,
  dataService: JenkinsDataService,
  presetStore: JenkinsParameterPresetStore,
  artifactActionHandler: ArtifactActionHandler,
  buildLogPreviewer: BuildLogPreviewer,
  buildComparePanelLauncher: BuildComparePanelLauncher,
  buildDetailsPanelLauncher: BuildDetailsPanelLauncher,
  queuedBuildWaiter: QueuedBuildWaiter,
  replayBuildWorkflow: ReplayBuildWorkflow,
  localJenkinsfileReplayWorkflow: LocalJenkinsfileReplayWorkflow,
  refreshHost: BuildCommandRefreshHost,
  buildManagement: BuildManagementCommandDependencies
): void {
  const { workflow: buildManagementWorkflow, descriptionDraftManager } = buildManagement;
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "jenkinsWorkbench.triggerBuild",
      (item?: JobTreeItem | PipelineTreeItem) =>
        triggerBuild(dataService, presetStore, queuedBuildWaiter, refreshHost, item)
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
      replayBuild(replayBuildWorkflow, item)
    ),
    vscode.commands.registerCommand(
      "jenkinsWorkbench.replayWithLocalJenkinsfile",
      (input?: BuildTreeItem | vscode.Uri) => localJenkinsfileReplayWorkflow.run(refreshHost, input)
    ),
    vscode.commands.registerCommand("jenkinsWorkbench.quickReplayBuild", (item?: BuildTreeItem) =>
      quickReplayBuild(dataService, refreshHost, item)
    ),
    vscode.commands.registerCommand("jenkinsWorkbench.runReplayDraft", (uri?: vscode.Uri) =>
      runReplayDraft(replayBuildWorkflow, refreshHost, uri)
    ),
    vscode.commands.registerCommand("jenkinsWorkbench.rebuildBuild", (item?: BuildTreeItem) =>
      rebuildBuild(dataService, refreshHost, item)
    ),
    vscode.commands.registerCommand("jenkinsWorkbench.openInJenkins", (item?: OpenableTreeItem) =>
      openInJenkins(item)
    ),
    vscode.commands.registerCommand("jenkinsWorkbench.compareWithBuild", (item?: BuildTreeItem) =>
      compareWithBuild(dataService, buildComparePanelLauncher, item)
    ),
    vscode.commands.registerCommand("jenkinsWorkbench.showBuildDetails", (item?: BuildTreeItem) =>
      showBuildDetails(buildDetailsPanelLauncher, item)
    ),
    vscode.commands.registerCommand(
      "jenkinsWorkbench.openLastFailedBuild",
      (item?: JobTreeItem | PipelineTreeItem) =>
        openLastFailedBuild(dataService, buildDetailsPanelLauncher, item)
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
    ),
    vscode.commands.registerCommand("jenkinsWorkbench.deleteBuild", (item?: BuildTreeItem) =>
      deleteBuild(buildManagementWorkflow, item)
    ),
    vscode.commands.registerCommand("jenkinsWorkbench.keepBuildForever", (item?: BuildTreeItem) =>
      keepBuildForever(buildManagementWorkflow, item)
    ),
    vscode.commands.registerCommand("jenkinsWorkbench.stopKeepingBuild", (item?: BuildTreeItem) =>
      stopKeepingBuild(buildManagementWorkflow, item)
    ),
    vscode.commands.registerCommand(
      "jenkinsWorkbench.editBuildDescription",
      (item?: BuildTreeItem) => editBuildDescription(buildManagementWorkflow, item)
    ),
    vscode.commands.registerCommand(
      "jenkinsWorkbench.editBuildDisplayName",
      (item?: BuildTreeItem) => editBuildDisplayName(buildManagementWorkflow, item)
    ),
    vscode.commands.registerCommand("jenkinsWorkbench.submitBuildDescription", (uri?: vscode.Uri) =>
      buildManagementWorkflow.submitDescriptionDraft(uri)
    ),
    // The draft manager is built at activation; the workflow resolves on the first manual save.
    descriptionDraftManager.onDidRequestSubmit((uri) => {
      void buildManagementWorkflow.submitDescriptionDraft(uri);
    })
  );
}

export type { BuildCommandRefreshHost };
