import * as vscode from "vscode";
import { formatScopeLabel } from "../../formatters/ScopeFormatters";
import { formatEnvironmentDisplayName } from "../../jenkins/EnvironmentLabels";
import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import { toJenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import type { JenkinsEnvironmentStore } from "../../storage/JenkinsEnvironmentStore";
import {
  InstanceTreeItem,
  type JenkinsFolderTreeItem,
  JobsFolderTreeItem
} from "../../tree/TreeItems";
import { getTreeItemLabel } from "../CommandUtils";
import type { JobNewItemTarget } from "./JobNewItemWorkflow";

export type JobNewItemTreeTarget = InstanceTreeItem | JobsFolderTreeItem | JenkinsFolderTreeItem;

export class JobNewItemTargetResolver {
  constructor(private readonly environmentStore: JenkinsEnvironmentStore) {}

  resolveFromTreeItem(item: JobNewItemTreeTarget): JobNewItemTarget | undefined {
    if (item instanceof InstanceTreeItem) {
      return {
        environment: item,
        parentUrl: item.url,
        locationLabel: formatEnvironmentTargetLabel(item)
      };
    }

    if (item instanceof JobsFolderTreeItem) {
      return {
        environment: item.environment,
        parentUrl: item.environment.url,
        locationLabel: formatEnvironmentTargetLabel(item.environment)
      };
    }

    if (item.folderKind === "multibranch") {
      void vscode.window.showInformationMessage(
        "Select an environment or regular folder. Multibranch folders cannot contain new items."
      );
      return undefined;
    }

    return {
      environment: item.environment,
      parentUrl: item.folderUrl,
      locationLabel: `folder "${getTreeItemLabel(item)}" in ${formatEnvironmentTargetLabel(item.environment)}`
    };
  }

  async resolveFromEnvironmentPicker(): Promise<JobNewItemTarget | undefined> {
    const environments = await this.environmentStore.listEnvironmentsWithScope();
    if (environments.length === 0) {
      void vscode.window.showInformationMessage("No Jenkins environments are configured.");
      return undefined;
    }

    const picks = environments.map((environment) => ({
      label: formatEnvironmentDisplayName(environment),
      description: formatScopeLabel(environment.scope),
      detail: environment.name?.trim() ? environment.url : undefined,
      environment
    }));
    const selected = await vscode.window.showQuickPick(picks, {
      placeHolder: "Select a Jenkins environment for the new item",
      matchOnDescription: true,
      matchOnDetail: true,
      ignoreFocusOut: true
    });
    if (!selected) {
      return undefined;
    }

    const environmentRef = toJenkinsEnvironmentRef(selected.environment);
    return {
      environment: environmentRef,
      parentUrl: environmentRef.url,
      locationLabel: formatEnvironmentTargetLabel(environmentRef)
    };
  }
}

function formatEnvironmentTargetLabel(environment: JenkinsEnvironmentRef): string {
  return `${formatEnvironmentDisplayName(environment)} (${formatScopeLabel(environment.scope)})`;
}
