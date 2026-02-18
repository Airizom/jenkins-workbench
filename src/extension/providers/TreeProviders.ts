import * as vscode from "vscode";
import type { BuildListFetchOptions } from "../../jenkins/JenkinsDataService";
import type { BuildTooltipOptions } from "../../tree/BuildTooltips";
import { JenkinsWorkbenchTreeDataProvider } from "../../tree/TreeDataProvider";
import { TreeExpansionState } from "../../tree/TreeExpansionState";
import { JenkinsTreeFilter } from "../../tree/TreeFilter";
import type { WorkbenchTreeElement } from "../../tree/TreeItems";
import { DefaultJenkinsTreeNavigator } from "../../tree/TreeNavigator";
import type { ExtensionContainer } from "../container/ExtensionContainer";

const VIEW_ID = "jenkinsWorkbench.tree";

export interface TreeProviderOptions {
  buildTooltipOptions: BuildTooltipOptions;
  buildListFetchOptions: BuildListFetchOptions;
}

export function registerTreeProviders(
  container: ExtensionContainer,
  options: TreeProviderOptions
): void {
  container.register("treeFilter", () => new JenkinsTreeFilter(container.get("viewStateStore")));

  container.register(
    "treeDataProvider",
    () =>
      new JenkinsWorkbenchTreeDataProvider(
        container.get("environmentStore"),
        container.get("dataService"),
        container.get("watchStore"),
        container.get("pinStore"),
        container.get("treeFilter"),
        options.buildTooltipOptions,
        options.buildListFetchOptions,
        container.get("pendingInputCoordinator")
      )
  );

  container.register("treeView", () =>
    vscode.window.createTreeView<WorkbenchTreeElement>(VIEW_ID, {
      treeDataProvider: container.get("treeDataProvider")
    })
  );

  container.register(
    "treeExpansionState",
    () => new TreeExpansionState(container.get("treeView"), container.get("treeDataProvider"))
  );

  container.register(
    "treeNavigator",
    () =>
      new DefaultJenkinsTreeNavigator(container.get("treeView"), container.get("treeDataProvider"))
  );
}
