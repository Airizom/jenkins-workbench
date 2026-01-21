import * as vscode from "vscode";
import type { JenkinsDataService } from "../../jenkins/JenkinsDataService";
import type { JobConfigPreviewer } from "../../ui/JobConfigPreviewer";
import type { JobTreeItem, PipelineTreeItem } from "../../tree/TreeItems";
import { formatActionError, getTreeItemLabel } from "../CommandUtils";
import type { JobConfigUpdateWorkflow } from "./JobConfigUpdateWorkflow";

export async function viewJobConfig(
  dataService: JenkinsDataService,
  previewer: JobConfigPreviewer,
  item?: JobTreeItem | PipelineTreeItem
): Promise<void> {
  if (!item) {
    void vscode.window.showInformationMessage("Select a job or pipeline to view its config.");
    return;
  }

  const label = getTreeItemLabel(item);

  try {
    const configXml = await dataService.getJobConfigXml(item.environment, item.jobUrl);
    await previewer.preview(configXml);
  } catch (error) {
    void vscode.window.showErrorMessage(
      `Unable to open config.xml for ${label}: ${formatActionError(error)}`
    );
  }
}

export async function updateJobConfig(
  workflow: JobConfigUpdateWorkflow,
  item?: JobTreeItem | PipelineTreeItem
): Promise<void> {
  await workflow.startUpdate(item);
}

export async function submitJobConfigDraft(
  workflow: JobConfigUpdateWorkflow,
  refreshHost: Parameters<JobConfigUpdateWorkflow["submitDraft"]>[0],
  uri?: vscode.Uri
): Promise<void> {
  await workflow.submitDraft(refreshHost, uri);
}
