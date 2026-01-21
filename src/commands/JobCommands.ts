import * as vscode from "vscode";
import type { JenkinsDataService } from "../jenkins/JenkinsDataService";
import type { JobConfigDraftManager } from "../services/JobConfigDraftManager";
import type { JobTreeItem, PipelineTreeItem } from "../tree/TreeItems";
import type { JobConfigPreviewer } from "../ui/JobConfigPreviewer";
import { submitJobConfigDraft, updateJobConfig, viewJobConfig } from "./job/JobCommandHandlers";
import type { JobConfigUpdateWorkflow } from "./job/JobConfigUpdateWorkflow";
import type { JobCommandRefreshHost } from "./job/JobCommandTypes";

export function registerJobCommands(
  context: vscode.ExtensionContext,
  dataService: JenkinsDataService,
  jobConfigPreviewer: JobConfigPreviewer,
  refreshHost: JobCommandRefreshHost,
  draftManager: JobConfigDraftManager,
  workflow: JobConfigUpdateWorkflow
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "jenkinsWorkbench.viewJobConfig",
      (item?: JobTreeItem | PipelineTreeItem) =>
        viewJobConfig(dataService, jobConfigPreviewer, item)
    ),
    vscode.commands.registerCommand(
      "jenkinsWorkbench.updateJobConfig",
      (item?: JobTreeItem | PipelineTreeItem) =>
        updateJobConfig(workflow, item)
    ),
    vscode.commands.registerCommand("jenkinsWorkbench.submitJobConfig", (uri?: vscode.Uri) =>
      submitJobConfigDraft(workflow, refreshHost, uri)
    )
  );

  context.subscriptions.push(
    draftManager.onDidRequestSubmit((uri) => {
      void submitJobConfigDraft(workflow, refreshHost, uri);
    })
  );
}
