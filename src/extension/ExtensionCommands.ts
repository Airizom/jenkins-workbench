import type * as vscode from "vscode";
import { registerBuildCommands } from "../commands/BuildCommands";
import { registerEnvironmentCommands } from "../commands/EnvironmentCommands";
import { registerPinCommands } from "../commands/PinCommands";
import { registerQueueCommands } from "../commands/QueueCommands";
import { registerRefreshCommands } from "../commands/RefreshCommands";
import { registerSearchCommands } from "../commands/SearchCommands";
import { registerWatchCommands } from "../commands/WatchCommands";
import type { JenkinsClientProvider } from "../jenkins/JenkinsClientProvider";
import type { JenkinsDataService } from "../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import type { JenkinsQueuePoller } from "../queue/JenkinsQueuePoller";
import type { BuildConsoleExporter } from "../services/BuildConsoleExporter";
import type { QueuedBuildWaiter } from "../services/QueuedBuildWaiter";
import type { PendingInputRefreshCoordinator } from "../services/PendingInputRefreshCoordinator";
import type { ArtifactActionHandler } from "../ui/ArtifactActionHandler";
import type { JenkinsEnvironmentStore } from "../storage/JenkinsEnvironmentStore";
import type { JenkinsPinStore } from "../storage/JenkinsPinStore";
import type { JenkinsViewStateStore } from "../storage/JenkinsViewStateStore";
import type { JenkinsWatchStore } from "../storage/JenkinsWatchStore";
import type { JenkinsWorkbenchTreeDataProvider } from "../tree/TreeDataProvider";
import type { DefaultJenkinsTreeNavigator } from "../tree/TreeNavigator";
import { syncNoEnvironmentsContext } from "./contextKeys";

export interface ExtensionCommandDependencies {
  environmentStore: JenkinsEnvironmentStore;
  watchStore: JenkinsWatchStore;
  pinStore: JenkinsPinStore;
  clientProvider: JenkinsClientProvider;
  dataService: JenkinsDataService;
  artifactActionHandler: ArtifactActionHandler;
  consoleExporter: BuildConsoleExporter;
  queuedBuildWaiter: QueuedBuildWaiter;
  pendingInputCoordinator: PendingInputRefreshCoordinator;
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
      void syncNoEnvironmentsContext(dependencies.environmentStore);
    },
    onEnvironmentRemoved: (environment: JenkinsEnvironmentRef) =>
      dependencies.queuePoller.clearEnvironment(environment)
  };

  registerEnvironmentCommands(
    context,
    dependencies.environmentStore,
    dependencies.watchStore,
    dependencies.pinStore,
    dependencies.clientProvider,
    refreshHost
  );

  registerBuildCommands(
    context,
    dependencies.dataService,
    dependencies.artifactActionHandler,
    dependencies.consoleExporter,
    dependencies.queuedBuildWaiter,
    dependencies.pendingInputCoordinator,
    refreshHost
  );

  registerQueueCommands(context, dependencies.dataService, refreshHost);

  registerWatchCommands(context, dependencies.watchStore, refreshHost);

  registerPinCommands(context, dependencies.pinStore, refreshHost);

  registerSearchCommands(
    context,
    dependencies.environmentStore,
    dependencies.dataService,
    dependencies.viewStateStore,
    dependencies.treeNavigator
  );

  registerRefreshCommands(context, dependencies.treeDataProvider);
}
