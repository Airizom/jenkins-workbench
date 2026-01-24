import * as vscode from "vscode";
import { JenkinsQueuePoller } from "../queue/JenkinsQueuePoller";
import { JenkinsStatusPoller } from "../watch/JenkinsStatusPoller";
import { registerExtensionCommands } from "./ExtensionCommands";
import { syncJenkinsfileContext, syncNoEnvironmentsContext } from "./contextKeys";
import {
  getBuildListFetchOptions,
  getBuildTooltipOptions,
  getCacheTtlMs,
  getArtifactActionOptions,
  getArtifactPreviewCacheMaxBytes,
  getArtifactPreviewCacheMaxEntries,
  getArtifactPreviewCacheTtlMs,
  getArtifactMaxDownloadBytes,
  getExtensionConfiguration,
  getJenkinsfileValidationConfig,
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
import { JenkinsfileHoverProvider } from "../validation/editor/JenkinsfileHoverProvider";
import { JenkinsfileQuickFixProvider } from "../validation/editor/JenkinsfileQuickFixProvider";
import { JenkinsfileValidationCodeLensProvider } from "../validation/editor/JenkinsfileValidationCodeLensProvider";

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
  services.jenkinsfileValidationCoordinator.start();

  const jenkinsfileQuickFixProvider = new JenkinsfileQuickFixProvider(
    services.jenkinsfileMatcher
  );
  const jenkinsfileHoverProvider = new JenkinsfileHoverProvider(
    services.jenkinsfileMatcher,
    services.jenkinsfileValidationCoordinator
  );
  const jenkinsfileCodeLensProvider = new JenkinsfileValidationCodeLensProvider(
    services.jenkinsfileMatcher
  );

  context.subscriptions.push(
    services.treeView,
    services.treeDataProvider,
    services.pendingInputCoordinator,
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
    queuePoller,
    jenkinsfileEnvironmentResolver: services.jenkinsfileEnvironmentResolver,
    jenkinsfileValidationCoordinator: services.jenkinsfileValidationCoordinator
  });
}

export function deactivate(): void {
  // No-op for now.
}
