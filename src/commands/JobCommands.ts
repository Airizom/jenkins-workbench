import * as vscode from "vscode";
import type { JenkinsDataService } from "../jenkins/JenkinsDataService";
import type { JobTreeItem, PipelineTreeItem } from "../tree/TreeItems";
import type { JobConfigPreviewer } from "../ui/JobConfigPreviewer";
import { viewJobConfig } from "./job/JobCommandHandlers";

export function registerJobCommands(
  context: vscode.ExtensionContext,
  dataService: JenkinsDataService,
  jobConfigPreviewer: JobConfigPreviewer
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "jenkinsWorkbench.viewJobConfig",
      (item?: JobTreeItem | PipelineTreeItem) =>
        viewJobConfig(dataService, jobConfigPreviewer, item)
    )
  );
}
