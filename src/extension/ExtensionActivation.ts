import type * as vscode from "vscode";
import { JenkinsQueuePoller } from "../queue/JenkinsQueuePoller";
import { JenkinsStatusPoller } from "../watch/JenkinsStatusPoller";
import { registerExtensionCommands } from "./ExtensionCommands";
import { syncNoEnvironmentsContext } from "./contextKeys";
import {
  getCacheTtlMs,
  getExtensionConfiguration,
  getMaxCacheEntries,
  getPollIntervalSeconds,
  getQueuePollIntervalSeconds,
  getRequestTimeoutMs,
  getWatchErrorThreshold
} from "./ExtensionConfig";
import { createExtensionServices } from "./ExtensionServices";
import { registerExtensionSubscriptions } from "./ExtensionSubscriptions";
import { VscodeStatusNotifier } from "./VscodeStatusNotifier";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const config = getExtensionConfiguration();
  const cacheTtlMs = getCacheTtlMs(config);
  const pollIntervalSeconds = getPollIntervalSeconds(config);
  const watchErrorThreshold = getWatchErrorThreshold(config);
  const queuePollIntervalSeconds = getQueuePollIntervalSeconds(config);
  const maxCacheEntries = getMaxCacheEntries(config);
  const requestTimeoutMs = getRequestTimeoutMs(config);

  const services = createExtensionServices(context, {
    cacheTtlMs,
    maxCacheEntries,
    requestTimeoutMs
  });
  try {
    await services.environmentStore.migrateLegacyAuthConfigs();
  } catch (error) {
    console.warn("Failed to migrate legacy Jenkins auth config.", error);
  }
  await syncNoEnvironmentsContext(services.environmentStore);
  const notifier = new VscodeStatusNotifier();
  const poller = new JenkinsStatusPoller(
    services.environmentStore,
    services.clientProvider,
    services.watchStore,
    notifier,
    {
      refreshTree: () => services.treeDataProvider.onEnvironmentChanged()
    },
    pollIntervalSeconds,
    watchErrorThreshold
  );
  const queuePoller = new JenkinsQueuePoller(
    {
      refreshQueueView: (environment) => {
        services.treeDataProvider.refreshQueueFolder(environment);
      }
    },
    queuePollIntervalSeconds
  );

  poller.start();
  void services.viewStateStore.syncFilterContext();

  context.subscriptions.push(services.treeView, poller, queuePoller);

  registerExtensionSubscriptions(context, services, poller, queuePoller);
  registerExtensionCommands(context, {
    environmentStore: services.environmentStore,
    watchStore: services.watchStore,
    clientProvider: services.clientProvider,
    dataService: services.dataService,
    viewStateStore: services.viewStateStore,
    treeNavigator: services.treeNavigator,
    treeDataProvider: services.treeDataProvider,
    queuePoller
  });
}

export function deactivate(): void {
  // No-op for now.
}
