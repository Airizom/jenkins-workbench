import * as vscode from "vscode";
import { JenkinsQueuePoller } from "../queue/JenkinsQueuePoller";
import { JenkinsStatusPoller } from "../watch/JenkinsStatusPoller";
import { registerExtensionCommands } from "./ExtensionCommands";
import { syncNoEnvironmentsContext } from "./contextKeys";
import {
  getBuildListFetchOptions,
  getBuildTooltipOptions,
  getCacheTtlMs,
  getArtifactActionOptions,
  getArtifactMaxDownloadBytes,
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
import { ARTIFACT_PREVIEW_SCHEME } from "../ui/ArtifactPreviewProvider";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const config = getExtensionConfiguration();
  const cacheTtlMs = getCacheTtlMs(config);
  const pollIntervalSeconds = getPollIntervalSeconds(config);
  const watchErrorThreshold = getWatchErrorThreshold(config);
  const queuePollIntervalSeconds = getQueuePollIntervalSeconds(config);
  const maxCacheEntries = getMaxCacheEntries(config);
  const requestTimeoutMs = getRequestTimeoutMs(config);
  const buildTooltipOptions = getBuildTooltipOptions(config);
  const buildListFetchOptions = getBuildListFetchOptions(config);
  const artifactActionOptionsProvider = (
    workspaceFolder: vscode.WorkspaceFolder
  ): { downloadRoot: string; maxBytes?: number } => {
    const folderConfig = vscode.workspace.getConfiguration("jenkinsWorkbench", workspaceFolder.uri);
    return getArtifactActionOptions(folderConfig);
  };
  const artifactPreviewOptionsProvider = (): { maxBytes?: number } => {
    const previewConfig = getExtensionConfiguration();
    return { maxBytes: getArtifactMaxDownloadBytes(previewConfig) };
  };

  const services = createExtensionServices(context, {
    cacheTtlMs,
    maxCacheEntries,
    requestTimeoutMs,
    buildTooltipOptions,
    buildListFetchOptions,
    artifactActionOptionsProvider,
    artifactPreviewOptionsProvider
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
    services.dataService,
    services.pendingInputCoordinator,
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

  context.subscriptions.push(
    services.treeView,
    services.treeDataProvider,
    services.pendingInputCoordinator,
    vscode.workspace.registerFileSystemProvider(
      ARTIFACT_PREVIEW_SCHEME,
      services.artifactPreviewProvider,
      { isReadonly: true }
    ),
    vscode.workspace.onDidCloseTextDocument((document) => {
      if (document.uri.scheme !== ARTIFACT_PREVIEW_SCHEME) {
        return;
      }
      services.artifactPreviewProvider.release(document.uri);
    }),
    poller,
    queuePoller
  );

  registerExtensionSubscriptions(context, services, poller, queuePoller);
  registerExtensionCommands(context, {
    environmentStore: services.environmentStore,
    watchStore: services.watchStore,
    pinStore: services.pinStore,
    clientProvider: services.clientProvider,
    dataService: services.dataService,
    artifactActionHandler: services.artifactActionHandler,
    consoleExporter: services.consoleExporter,
    queuedBuildWaiter: services.queuedBuildWaiter,
    pendingInputCoordinator: services.pendingInputCoordinator,
    viewStateStore: services.viewStateStore,
    treeNavigator: services.treeNavigator,
    treeDataProvider: services.treeDataProvider,
    queuePoller
  });
}

export function deactivate(): void {
  // No-op for now.
}
