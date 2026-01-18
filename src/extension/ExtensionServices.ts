import * as vscode from "vscode";
import { JenkinsClientProvider } from "../jenkins/JenkinsClientProvider";
import { JenkinsDataService } from "../jenkins/JenkinsDataService";
import { PendingInputRefreshCoordinator } from "../services/PendingInputRefreshCoordinator";
import { MAX_CONSOLE_CHARS } from "../services/ConsoleOutputConfig";
import { ArtifactActionService } from "../services/ArtifactActionService";
import { createFileArtifactFilesystem } from "../services/ArtifactFilesystem";
import {
  DefaultArtifactRetrievalService,
  type ArtifactRetrievalService
} from "../services/ArtifactRetrievalService";
import { ArtifactStorageService } from "../services/ArtifactStorageService";
import { QueuedBuildWaiter } from "../services/QueuedBuildWaiter";
import {
  BuildConsoleExporter,
  createNodeBuildConsoleFilesystem
} from "../services/BuildConsoleExporter";
import { BuildLogService } from "../services/BuildLogService";
import {
  ArtifactPreviewProvider,
  type ArtifactPreviewProviderOptions
} from "../ui/ArtifactPreviewProvider";
import { ArtifactPreviewer, type ArtifactPreviewOptionsProvider } from "../ui/ArtifactPreviewer";
import { BuildLogPreviewer } from "../ui/BuildLogPreviewer";
import { JobConfigPreviewer } from "../ui/JobConfigPreviewer";
import {
  DefaultArtifactActionHandler,
  type ArtifactActionHandler,
  type ArtifactActionOptionsProvider
} from "../ui/ArtifactActionHandler";
import { JenkinsEnvironmentStore } from "../storage/JenkinsEnvironmentStore";
import { JenkinsPinStore } from "../storage/JenkinsPinStore";
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
  pendingInputCoordinator: PendingInputRefreshCoordinator;
  queuedBuildWaiter: QueuedBuildWaiter;
  consoleExporter: BuildConsoleExporter;
  buildLogService: BuildLogService;
  artifactRetrievalService: ArtifactRetrievalService;
  artifactStorageService: ArtifactStorageService;
  artifactPreviewProvider: ArtifactPreviewProvider;
  buildLogPreviewer: BuildLogPreviewer;
  jobConfigPreviewer: JobConfigPreviewer;
  artifactActionHandler: ArtifactActionHandler;
  watchStore: JenkinsWatchStore;
  pinStore: JenkinsPinStore;
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
  artifactActionOptionsProvider: ArtifactActionOptionsProvider;
  artifactPreviewOptionsProvider: ArtifactPreviewOptionsProvider;
  artifactPreviewCacheOptions: ArtifactPreviewProviderOptions;
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
  const pendingInputCoordinator = new PendingInputRefreshCoordinator(dataService);
  const queuedBuildWaiter = new QueuedBuildWaiter(dataService);
  const consoleExporter = new BuildConsoleExporter(
    dataService,
    createNodeBuildConsoleFilesystem(),
    {
      maxConsoleChars: MAX_CONSOLE_CHARS
    }
  );
  const buildLogService = new BuildLogService(dataService);
  const artifactRetrievalService = new DefaultArtifactRetrievalService(dataService);
  const artifactStorageService = new ArtifactStorageService(
    artifactRetrievalService,
    createFileArtifactFilesystem()
  );
  const artifactActionService = new ArtifactActionService(artifactStorageService);
  const artifactPreviewProvider = new ArtifactPreviewProvider(options.artifactPreviewCacheOptions);
  const artifactPreviewer = new ArtifactPreviewer(
    artifactRetrievalService,
    artifactPreviewProvider,
    options.artifactPreviewOptionsProvider
  );
  const buildLogPreviewer = new BuildLogPreviewer(
    buildLogService,
    artifactPreviewProvider,
    MAX_CONSOLE_CHARS
  );
  const jobConfigPreviewer = new JobConfigPreviewer(artifactPreviewProvider);
  const artifactActionHandler = new DefaultArtifactActionHandler(
    artifactActionService,
    artifactPreviewer,
    options.artifactActionOptionsProvider
  );
  const watchStore = new JenkinsWatchStore(context);
  const pinStore = new JenkinsPinStore(context);
  const viewStateStore = new JenkinsViewStateStore(context);
  const treeFilter = new JenkinsTreeFilter(viewStateStore);
  const treeDataProvider = new JenkinsWorkbenchTreeDataProvider(
    environmentStore,
    dataService,
    watchStore,
    pinStore,
    treeFilter,
    options.buildTooltipOptions,
    options.buildListFetchOptions,
    pendingInputCoordinator
  );
  const treeView = vscode.window.createTreeView<WorkbenchTreeElement>(VIEW_ID, {
    treeDataProvider
  });
  const treeNavigator = new DefaultJenkinsTreeNavigator(treeView, treeDataProvider);

  return {
    environmentStore,
    clientProvider,
    dataService,
    pendingInputCoordinator,
    queuedBuildWaiter,
    consoleExporter,
    buildLogService,
    artifactRetrievalService,
    artifactStorageService,
    artifactPreviewProvider,
    buildLogPreviewer,
    jobConfigPreviewer,
    artifactActionHandler,
    watchStore,
    pinStore,
    viewStateStore,
    treeFilter,
    treeDataProvider,
    treeView,
    treeNavigator
  };
}
