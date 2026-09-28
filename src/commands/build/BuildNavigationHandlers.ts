import * as vscode from "vscode";
import type { JenkinsDataService } from "../../jenkins/JenkinsDataService";
import type { BuildDetailsPanelLauncher } from "../../panels/BuildDetailsPanelLauncher";
import { JenkinsViewTreeItem } from "../../tree/items/TreeJobItems";
import {
  BuildTreeItem,
  InstanceTreeItem,
  JenkinsFolderTreeItem,
  type JobTreeItem,
  NodeTreeItem,
  type PipelineTreeItem,
  QueueItemTreeItem
} from "../../tree/TreeItems";
import type { BuildLogPreviewer } from "../../ui/BuildLogPreviewer";
import { openExternalHttpUrlWithWarning } from "../../ui/OpenExternalUrl";
import { getTreeItemLabel, requireSelection, withActionErrorMessage } from "../CommandUtils";
import type { JenkinsJobTarget } from "./BuildCommandTargets";

export type OpenableTreeItem =
  | JobTreeItem
  | BuildTreeItem
  | NodeTreeItem
  | InstanceTreeItem
  | JenkinsFolderTreeItem
  | JenkinsViewTreeItem
  | QueueItemTreeItem;

function getOpenUrl(item: OpenableTreeItem): string | undefined {
  if (item instanceof BuildTreeItem) {
    return item.buildUrl;
  }
  if (item instanceof NodeTreeItem) {
    return item.nodeUrl;
  }
  if (item instanceof InstanceTreeItem) {
    return item.url;
  }
  if (item instanceof JenkinsFolderTreeItem) {
    return item.folderUrl;
  }
  if (item instanceof JenkinsViewTreeItem) {
    return item.viewUrl;
  }
  if (item instanceof QueueItemTreeItem) {
    return item.taskUrl;
  }
  return item.jobUrl;
}

export async function openInJenkins(item?: OpenableTreeItem): Promise<void> {
  const selected = requireSelection(item, "Select a Jenkins item to open.");
  if (!selected) {
    return;
  }

  if (selected instanceof NodeTreeItem && !selected.nodeUrl) {
    void vscode.window.showInformationMessage(
      "That node does not expose a stable URL in the Jenkins API."
    );
    return;
  }

  const url = getOpenUrl(selected);
  if (!url) {
    void vscode.window.showInformationMessage("That item does not have a Jenkins URL to open.");
    return;
  }

  await openExternalHttpUrlWithWarning(url, {
    targetLabel: "Jenkins URL"
  });
}

export async function showBuildDetails(
  buildDetailsPanelLauncher: BuildDetailsPanelLauncher,
  item?: BuildTreeItem
): Promise<void> {
  const selected = requireSelection(item, "Select a build to view details.");
  if (!selected) {
    return;
  }

  await withActionErrorMessage("Unable to open build details", async () => {
    await buildDetailsPanelLauncher.show({
      environment: selected.environment,
      buildUrl: selected.buildUrl,
      label: getTreeItemLabel(selected)
    });
  });
}

export async function openLastFailedBuild(
  dataService: JenkinsDataService,
  buildDetailsPanelLauncher: BuildDetailsPanelLauncher,
  item?: JobTreeItem | PipelineTreeItem
): Promise<void> {
  const selected = requireSelection(
    item,
    "Select a job or pipeline to locate the last failed build."
  );
  if (!selected) {
    return;
  }

  await openLastFailedBuildForTarget(dataService, buildDetailsPanelLauncher, {
    environment: selected.environment,
    jobUrl: selected.jobUrl,
    label: getTreeItemLabel(selected)
  });
}

export async function openLastFailedBuildForTarget(
  dataService: JenkinsDataService,
  buildDetailsPanelLauncher: BuildDetailsPanelLauncher,
  target: JenkinsJobTarget
): Promise<void> {
  await withActionErrorMessage(
    `Unable to open the last failed build for ${target.label}`,
    async () => {
      const lastFailed = await dataService.getLastFailedBuild(target.environment, target.jobUrl);
      if (!lastFailed) {
        void vscode.window.showInformationMessage(`No failed builds found for ${target.label}.`);
        return;
      }
      if (!lastFailed.url) {
        void vscode.window.showInformationMessage(
          `The last failed build for ${target.label} is missing a URL.`
        );
        return;
      }

      await buildDetailsPanelLauncher.show({
        environment: target.environment,
        buildUrl: lastFailed.url,
        label: `#${lastFailed.number}`
      });
    }
  );
}

export async function previewBuildLog(
  previewer: BuildLogPreviewer,
  item?: BuildTreeItem
): Promise<void> {
  const selected = requireSelection(item, "Select a build to preview logs.");
  if (!selected) {
    return;
  }

  const label = getTreeItemLabel(selected);
  const fileName = `build-${selected.buildNumber}.log`;

  await withActionErrorMessage(`Failed to preview logs for ${label}`, async () => {
    const result = await previewer.preview(selected.environment, selected.buildUrl, fileName);
    if (result.truncated) {
      void vscode.window.showInformationMessage(
        `Showing last ${result.maxChars.toLocaleString()} characters of console output for ${label}.`
      );
    }
  });
}
