import * as vscode from "vscode";
import type { BuildListFetchOptions } from "../../jenkins/JenkinsDataService";
import type { TreeActivityOptions } from "../../tree/ActivityTypes";
import type { BuildTooltipOptions } from "../../tree/BuildTooltips";
import { JenkinsWorkbenchTreeDataProvider } from "../../tree/TreeDataProvider";
import { TreeExpansionState } from "../../tree/TreeExpansionState";
import { JenkinsTreeFilter } from "../../tree/TreeFilter";
import type { WorkbenchTreeElement } from "../../tree/TreeItems";
import { DefaultJenkinsTreeNavigator } from "../../tree/TreeNavigator";
import type { TreeViewCurationOptions } from "../../tree/TreeViewCuration";
import { ActivityRefreshService } from "../../tree/activity/ActivityRefreshService";
import type { PartialExtensionProviderCatalog } from "../container/ExtensionContainer";

const VIEW_ID = "jenkinsWorkbench.tree";

export interface TreeProviderOptions {
  buildTooltipOptions: BuildTooltipOptions;
  buildListFetchOptions: BuildListFetchOptions;
  treeViewCurationOptions: TreeViewCurationOptions;
  activityOptions: TreeActivityOptions;
}

export function createTreeProviderCatalog(options: TreeProviderOptions) {
  return {
    treeFilter: (container) => new JenkinsTreeFilter(container.get("viewStateStore")),
    treeDataProvider: (container) =>
      new JenkinsWorkbenchTreeDataProvider(
        container.get("environmentStore"),
        container.get("dataService"),
        container.get("watchStore"),
        container.get("pinStore"),
        container.get("treeFilter"),
        options.buildTooltipOptions,
        options.buildListFetchOptions,
        options.treeViewCurationOptions,
        options.activityOptions,
        container.get("pendingInputCoordinator")
      ),
    treeView: (container) =>
      vscode.window.createTreeView<WorkbenchTreeElement>(VIEW_ID, {
        treeDataProvider: container.get("treeDataProvider")
      }),
    treeExpansionState: (container) =>
      new TreeExpansionState(container.get("treeView"), container.get("treeDataProvider")),
    treeNavigator: (container) =>
      new DefaultJenkinsTreeNavigator(container.get("treeView"), container.get("treeDataProvider")),
    activityRefreshService: (container) =>
      new ActivityRefreshService({
        activityOptions: options.activityOptions,
        refreshActivity: (environment) => {
          container.get("treeDataProvider").refreshActivity(environment);
        }
      })
  } satisfies PartialExtensionProviderCatalog;
}
