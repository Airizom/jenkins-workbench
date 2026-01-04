import type * as vscode from "vscode";
import { registerBuildCommands } from "../commands/BuildCommands";
import { registerEnvironmentCommands } from "../commands/EnvironmentCommands";
import { registerQueueCommands } from "../commands/QueueCommands";
import { registerRefreshCommands } from "../commands/RefreshCommands";
import { registerSearchCommands } from "../commands/SearchCommands";
import { registerWatchCommands } from "../commands/WatchCommands";
import type { JenkinsClientProvider } from "../jenkins/JenkinsClientProvider";
import type { JenkinsDataService } from "../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import type { JenkinsQueuePoller } from "../queue/JenkinsQueuePoller";
import type { JenkinsEnvironmentStore } from "../storage/JenkinsEnvironmentStore";
import type { JenkinsViewStateStore } from "../storage/JenkinsViewStateStore";
import type { JenkinsWatchStore } from "../storage/JenkinsWatchStore";
import type { JenkinsWorkbenchTreeDataProvider } from "../tree/TreeDataProvider";
import type { DefaultJenkinsTreeNavigator } from "../tree/TreeNavigator";

export interface ExtensionCommandDependencies {
  environmentStore: JenkinsEnvironmentStore;
  watchStore: JenkinsWatchStore;
  clientProvider: JenkinsClientProvider;
  dataService: JenkinsDataService;
  viewStateStore: JenkinsViewStateStore;
  treeNavigator: DefaultJenkinsTreeNavigator;
  treeDataProvider: JenkinsWorkbenchTreeDataProvider;
  queuePoller: JenkinsQueuePoller;
}

export function registerExtensionCommands(
  context: vscode.ExtensionContext,
  dependencies: ExtensionCommandDependencies
): void {
  const updateQueueEnvironment = async (environmentId?: string): Promise<void> => {
    if (!environmentId) {
      return;
    }
    const environments = await dependencies.environmentStore.listEnvironmentsWithScope();
    const environment = environments.find((entry) => entry.id === environmentId);
    if (!environment) {
      return;
    }
    dependencies.queuePoller.updateEnvironment({
      environmentId: environment.id,
      scope: environment.scope,
      url: environment.url,
      username: environment.username
    });
  };

  const refreshHost = {
    refreshEnvironment: (environmentId?: string) => {
      dependencies.treeDataProvider.onEnvironmentChanged(environmentId);
      void updateQueueEnvironment(environmentId);
    },
    onEnvironmentRemoved: (environment: JenkinsEnvironmentRef) =>
      dependencies.queuePoller.clearEnvironment(environment)
  };

  registerEnvironmentCommands(
    context,
    dependencies.environmentStore,
    dependencies.watchStore,
    dependencies.clientProvider,
    refreshHost
  );

  registerBuildCommands(context, dependencies.dataService, refreshHost);

  registerQueueCommands(context, dependencies.dataService, refreshHost);

  registerWatchCommands(context, dependencies.watchStore, refreshHost);

  registerSearchCommands(
    context,
    dependencies.environmentStore,
    dependencies.dataService,
    dependencies.viewStateStore,
    dependencies.treeNavigator
  );

  registerRefreshCommands(context, dependencies.treeDataProvider);
}
