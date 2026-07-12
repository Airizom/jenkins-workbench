import * as vscode from "vscode";
import { formatScopeLabel } from "../../formatters/ScopeFormatters";
import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import type {
  EnvironmentWithScope,
  JenkinsEnvironmentStore
} from "../../storage/JenkinsEnvironmentStore";
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
      label: environment.url,
      description: formatScopeLabel(environment.scope),
      environment
    }));
    const selected = await vscode.window.showQuickPick(picks, {
      placeHolder: "Select a Jenkins environment for the new item",
      matchOnDescription: true,
      ignoreFocusOut: true
    });
    if (!selected) {
      return undefined;
    }

    const environmentRef = toEnvironmentRef(selected.environment);
    return {
      environment: environmentRef,
      parentUrl: environmentRef.url,
      locationLabel: formatEnvironmentTargetLabel(environmentRef)
    };
  }
}

function toEnvironmentRef(environment: EnvironmentWithScope): JenkinsEnvironmentRef {
  return {
    environmentId: environment.id,
    scope: environment.scope,
    url: environment.url,
    username: environment.username
  };
}

function formatEnvironmentTargetLabel(environment: JenkinsEnvironmentRef): string {
  return `${environment.url} (${formatScopeLabel(environment.scope)})`;
}
