import * as vscode from "vscode";
import type { JenkinsDataService } from "../jenkins/JenkinsDataService";
import type { JobConfigDraftManager } from "../services/JobConfigDraftManager";
import type { JenkinsPinStore } from "../storage/JenkinsPinStore";
import type { JenkinsWatchStore } from "../storage/JenkinsWatchStore";
import type { JobTreeItem, PipelineTreeItem } from "../tree/TreeItems";
import type { JobConfigPreviewer } from "../ui/JobConfigPreviewer";
import {
  type JobActionDependencies,
  copyJob,
  deleteJob,
  disableJob,
  enableJob,
  renameJob
} from "./job/JobActionHandlers";
import { submitJobConfigDraft, updateJobConfig, viewJobConfig } from "./job/JobCommandHandlers";
import type { JobCommandRefreshHost } from "./job/JobCommandTypes";
import type { JobConfigUpdateWorkflow } from "./job/JobConfigUpdateWorkflow";

export function registerJobCommands(
  context: vscode.ExtensionContext,
  dataService: JenkinsDataService,
  jobConfigPreviewer: JobConfigPreviewer,
  refreshHost: JobCommandRefreshHost,
  draftManager: JobConfigDraftManager,
  workflow: JobConfigUpdateWorkflow,
  pinStore: JenkinsPinStore,
  watchStore: JenkinsWatchStore
): void {
  const actionDeps: JobActionDependencies = {
    dataService,
    pinStore,
    watchStore,
    refreshHost
  };

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "jenkinsWorkbench.viewJobConfig",
      (item?: JobTreeItem | PipelineTreeItem) =>
        viewJobConfig(dataService, jobConfigPreviewer, item)
    ),
    vscode.commands.registerCommand(
      "jenkinsWorkbench.updateJobConfig",
      (item?: JobTreeItem | PipelineTreeItem) => updateJobConfig(workflow, item)
    ),
    vscode.commands.registerCommand("jenkinsWorkbench.submitJobConfig", (uri?: vscode.Uri) =>
      submitJobConfigDraft(workflow, refreshHost, uri)
    ),
    vscode.commands.registerCommand(
      "jenkinsWorkbench.enableJob",
      (item?: JobTreeItem | PipelineTreeItem) => enableJob(actionDeps, item)
    ),
    vscode.commands.registerCommand(
      "jenkinsWorkbench.disableJob",
      (item?: JobTreeItem | PipelineTreeItem) => disableJob(actionDeps, item)
    ),
    vscode.commands.registerCommand(
      "jenkinsWorkbench.renameJob",
      (item?: JobTreeItem | PipelineTreeItem) => renameJob(actionDeps, item)
    ),
    vscode.commands.registerCommand(
      "jenkinsWorkbench.deleteJob",
      (item?: JobTreeItem | PipelineTreeItem) => deleteJob(actionDeps, item)
    ),
    vscode.commands.registerCommand(
      "jenkinsWorkbench.copyJob",
      (item?: JobTreeItem | PipelineTreeItem) => copyJob(actionDeps, item)
    )
  );

  context.subscriptions.push(
    draftManager.onDidRequestSubmit((uri) => {
      void submitJobConfigDraft(workflow, refreshHost, uri);
    })
  );
}
