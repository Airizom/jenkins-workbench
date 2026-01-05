import * as vscode from "vscode";
import { JenkinsClientProvider } from "../jenkins/JenkinsClientProvider";
import { JenkinsDataService } from "../jenkins/JenkinsDataService";
import { JenkinsEnvironmentStore } from "../storage/JenkinsEnvironmentStore";
import { JenkinsViewStateStore } from "../storage/JenkinsViewStateStore";
import { JenkinsWatchStore } from "../storage/JenkinsWatchStore";
import type { BuildListFetchOptions } from "../jenkins/JenkinsDataService";
import type { BuildTooltipOptions } from "../tree/BuildTooltips";
import { JenkinsWorkbenchTreeDataProvider } from "../tree/TreeDataProvider";
import { JenkinsTreeFilter } from "../tree/TreeFilter";
import type { WorkbenchTreeElement } from "../tree/TreeItems";
import { DefaultJenkinsTreeNavigator } from "../tree/TreeNavigator";

export interface ExtensionServices {
  environmentStore: JenkinsEnvironmentStore;
  clientProvider: JenkinsClientProvider;
  dataService: JenkinsDataService;
  watchStore: JenkinsWatchStore;
  viewStateStore: JenkinsViewStateStore;
  treeFilter: JenkinsTreeFilter;
  treeDataProvider: JenkinsWorkbenchTreeDataProvider;
  treeView: vscode.TreeView<WorkbenchTreeElement>;
  treeNavigator: DefaultJenkinsTreeNavigator;
}

export interface ExtensionServicesOptions {
  cacheTtlMs: number;
  maxCacheEntries: number;
  requestTimeoutMs: number;
  buildTooltipOptions: BuildTooltipOptions;
  buildListFetchOptions: BuildListFetchOptions;
}

const VIEW_ID = "jenkinsWorkbench.tree";

export function createExtensionServices(
  context: vscode.ExtensionContext,
  options: ExtensionServicesOptions
): ExtensionServices {
  const environmentStore = new JenkinsEnvironmentStore(context);
  const clientProvider = new JenkinsClientProvider(environmentStore, {
    requestTimeoutMs: options.requestTimeoutMs
  });
  const dataService = new JenkinsDataService(clientProvider, {
    cacheTtlMs: options.cacheTtlMs,
    maxCacheEntries: options.maxCacheEntries
  });
  const watchStore = new JenkinsWatchStore(context);
  const viewStateStore = new JenkinsViewStateStore(context);
  const treeFilter = new JenkinsTreeFilter(viewStateStore);
  const treeDataProvider = new JenkinsWorkbenchTreeDataProvider(
    environmentStore,
    dataService,
    watchStore,
    treeFilter,
    options.buildTooltipOptions,
    options.buildListFetchOptions
  );
  const treeView = vscode.window.createTreeView<WorkbenchTreeElement>(VIEW_ID, {
    treeDataProvider
  });
  const treeNavigator = new DefaultJenkinsTreeNavigator(treeView, treeDataProvider);

  return {
    environmentStore,
    clientProvider,
    dataService,
    watchStore,
    viewStateStore,
    treeFilter,
    treeDataProvider,
    treeView,
    treeNavigator
  };
}
