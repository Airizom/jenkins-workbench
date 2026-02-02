import * as vscode from "vscode";
import { BuildDetailsPanel } from "../panels/BuildDetailsPanel";
import { NodeDetailsPanel } from "../panels/NodeDetailsPanel";
import { JenkinsQueuePoller } from "../queue/JenkinsQueuePoller";
import { registerJenkinsTasks } from "../tasks/JenkinsTasks";
import { ARTIFACT_PREVIEW_SCHEME } from "../ui/ArtifactPreviewProvider";
import { JenkinsfileHoverProvider } from "../validation/editor/JenkinsfileHoverProvider";
import { JenkinsfileQuickFixProvider } from "../validation/editor/JenkinsfileQuickFixProvider";
import { JenkinsfileValidationCodeLensProvider } from "../validation/editor/JenkinsfileValidationCodeLensProvider";
import { JenkinsStatusPoller } from "../watch/JenkinsStatusPoller";
import { registerExtensionCommands } from "./ExtensionCommands";
import {
  getArtifactActionOptions,
  getArtifactMaxDownloadBytes,
  getArtifactPreviewCacheMaxBytes,
  getArtifactPreviewCacheMaxEntries,
  getArtifactPreviewCacheTtlMs,
  getBuildListFetchOptions,
  getBuildTooltipOptions,
  getCacheTtlMs,
  getExtensionConfiguration,
  getJenkinsfileValidationConfig,
  getMaxCacheEntries,
  getPollIntervalSeconds,
  getQueuePollIntervalSeconds,
  getRequestTimeoutMs,
  getWatchErrorThreshold
} from "./ExtensionConfig";
import { createExtensionRefreshHost } from "./ExtensionRefreshHost";
import { createExtensionServices } from "./ExtensionServices";
import { registerExtensionSubscriptions } from "./ExtensionSubscriptions";
import { JenkinsWorkbenchDeepLinkBuildHandler } from "./JenkinsWorkbenchDeepLinkBuildHandler";
import { JenkinsWorkbenchDeepLinkJobHandler } from "./JenkinsWorkbenchDeepLinkJobHandler";
import { JenkinsWorkbenchUriHandler } from "./JenkinsWorkbenchUriHandler";
import { VscodeStatusNotifier } from "./VscodeStatusNotifier";
import { syncJenkinsfileContext, syncNoEnvironmentsContext } from "./contextKeys";

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
  const artifactPreviewCacheMaxEntries = getArtifactPreviewCacheMaxEntries(config);
  const artifactPreviewCacheMaxBytes = getArtifactPreviewCacheMaxBytes(config);
  const artifactPreviewCacheTtlMs = getArtifactPreviewCacheTtlMs(config);
  const jenkinsfileValidationConfig = getJenkinsfileValidationConfig(config);
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
    artifactPreviewOptionsProvider,
    artifactPreviewCacheOptions: {
      maxEntries: artifactPreviewCacheMaxEntries,
      maxTotalBytes: artifactPreviewCacheMaxBytes,
      ttlMs: artifactPreviewCacheTtlMs
    },
    jenkinsfileValidationConfig
  });
  try {
    await services.environmentStore.migrateLegacyAuthConfigs();
  } catch (error) {
    console.warn("Failed to migrate legacy Jenkins auth config.", error);
  }
  await syncNoEnvironmentsContext(services.environmentStore);
  void syncJenkinsfileContext(services.jenkinsfileMatcher);
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
  const watchErrorSubscription = poller.onDidChangeWatchErrorCount((count) => {
    services.treeDataProvider.setWatchErrorCount(count);
  });
  const queuePoller = new JenkinsQueuePoller(
    {
      refreshQueueView: (environment) => {
        services.treeDataProvider.refreshQueueFolder(environment);
      }
    },
    queuePollIntervalSeconds
  );
  const refreshHost = createExtensionRefreshHost(
    services.environmentStore,
    services.treeDataProvider,
    queuePoller
  );
  const buildDeepLinkHandler = new JenkinsWorkbenchDeepLinkBuildHandler(
    services.dataService,
    services.artifactActionHandler,
    services.consoleExporter,
    refreshHost,
    services.pendingInputCoordinator,
    context.extensionUri
  );
  const jobDeepLinkHandler = new JenkinsWorkbenchDeepLinkJobHandler(services.treeNavigator);
  const uriHandler = new JenkinsWorkbenchUriHandler(
    services.environmentStore,
    buildDeepLinkHandler,
    jobDeepLinkHandler
  );
  const buildDetailsSerializer = vscode.window.registerWebviewPanelSerializer(
    "jenkinsWorkbench.buildDetails",
    {
      deserializeWebviewPanel: async (panel, state) => {
        await BuildDetailsPanel.revive(panel, state, {
          dataService: services.dataService,
          artifactActionHandler: services.artifactActionHandler,
          consoleExporter: services.consoleExporter,
          refreshHost,
          pendingInputProvider: services.pendingInputCoordinator,
          environmentStore: services.environmentStore,
          extensionUri: context.extensionUri
        });
      }
    }
  );
  const nodeDetailsSerializer = vscode.window.registerWebviewPanelSerializer(
    "jenkinsWorkbench.nodeDetails",
    {
      deserializeWebviewPanel: async (panel, state) => {
        await NodeDetailsPanel.revive(panel, state, {
          dataService: services.dataService,
          environmentStore: services.environmentStore,
          extensionUri: context.extensionUri
        });
      }
    }
  );

  poller.start();
  void services.viewStateStore.syncFilterContext();
  services.jenkinsfileValidationCoordinator.start();

  const jenkinsfileQuickFixProvider = new JenkinsfileQuickFixProvider(services.jenkinsfileMatcher);
  const jenkinsfileHoverProvider = new JenkinsfileHoverProvider(
    services.jenkinsfileMatcher,
    services.jenkinsfileValidationCoordinator
  );
  const jenkinsfileCodeLensProvider = new JenkinsfileValidationCodeLensProvider(
    services.jenkinsfileMatcher,
    services.jenkinsfileValidationCoordinator
  );

  context.subscriptions.push(
    services.treeView,
    services.treeDataProvider,
    services.pendingInputCoordinator,
    buildDetailsSerializer,
    nodeDetailsSerializer,
    vscode.window.registerUriHandler(uriHandler),
    jenkinsfileCodeLensProvider,
    vscode.workspace.registerFileSystemProvider(
      ARTIFACT_PREVIEW_SCHEME,
      services.artifactPreviewProvider,
      { isReadonly: true }
    ),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      void syncJenkinsfileContext(services.jenkinsfileMatcher, editor);
    }),
    vscode.workspace.onDidSaveTextDocument(() => {
      void syncJenkinsfileContext(services.jenkinsfileMatcher);
    }),
    vscode.workspace.onDidRenameFiles(() => {
      void syncJenkinsfileContext(services.jenkinsfileMatcher);
    }),
    vscode.workspace.onDidCloseTextDocument((document) => {
      if (document.uri.scheme !== ARTIFACT_PREVIEW_SCHEME) {
        return;
      }
      services.artifactPreviewProvider.release(document.uri);
    }),
    poller,
    queuePoller,
    watchErrorSubscription,
    services.jenkinsfileValidationCoordinator,
    services.jenkinsfileValidationStatusBar,
    vscode.languages.registerCodeActionsProvider(
      [{ scheme: "file" }, { scheme: "untitled" }],
      jenkinsfileQuickFixProvider,
      { providedCodeActionKinds: JenkinsfileQuickFixProvider.providedCodeActionKinds }
    ),
    vscode.languages.registerHoverProvider(
      [{ scheme: "file" }, { scheme: "untitled" }],
      jenkinsfileHoverProvider
    ),
    vscode.languages.registerCodeLensProvider(
      [{ scheme: "file" }, { scheme: "untitled" }],
      jenkinsfileCodeLensProvider
    )
  );

  registerExtensionSubscriptions(context, services, poller, queuePoller);
  registerExtensionCommands(context, {
    environmentStore: services.environmentStore,
    watchStore: services.watchStore,
    pinStore: services.pinStore,
    clientProvider: services.clientProvider,
    dataService: services.dataService,
    artifactActionHandler: services.artifactActionHandler,
    buildLogPreviewer: services.buildLogPreviewer,
    jobConfigPreviewer: services.jobConfigPreviewer,
    jobConfigDraftManager: services.jobConfigDraftManager,
    jobConfigUpdateWorkflow: services.jobConfigUpdateWorkflow,
    consoleExporter: services.consoleExporter,
    queuedBuildWaiter: services.queuedBuildWaiter,
    pendingInputCoordinator: services.pendingInputCoordinator,
    viewStateStore: services.viewStateStore,
    treeNavigator: services.treeNavigator,
    treeDataProvider: services.treeDataProvider,
    jenkinsfileEnvironmentResolver: services.jenkinsfileEnvironmentResolver,
    jenkinsfileValidationCoordinator: services.jenkinsfileValidationCoordinator,
    refreshHost
  });
  registerJenkinsTasks(
    context,
    services.environmentStore,
    services.dataService,
    refreshHost
  );
}

export function deactivate(): void {
  // No-op for now.
}
