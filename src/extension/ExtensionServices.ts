import * as vscode from "vscode";
import { JobConfigUpdateWorkflow } from "../commands/job/JobConfigUpdateWorkflow";
import { JenkinsClientProvider } from "../jenkins/JenkinsClientProvider";
import { JenkinsDataService } from "../jenkins/JenkinsDataService";
import type { BuildListFetchOptions } from "../jenkins/JenkinsDataService";
import { ArtifactActionService } from "../services/ArtifactActionService";
import { createFileArtifactFilesystem } from "../services/ArtifactFilesystem";
import {
  type ArtifactRetrievalService,
  DefaultArtifactRetrievalService
} from "../services/ArtifactRetrievalService";
import { ArtifactStorageService } from "../services/ArtifactStorageService";
import {
  BuildConsoleExporter,
  createNodeBuildConsoleFilesystem
} from "../services/BuildConsoleExporter";
import { BuildLogService } from "../services/BuildLogService";
import { MAX_CONSOLE_CHARS } from "../services/ConsoleOutputConfig";
import {
  JOB_CONFIG_DRAFT_SCHEME,
  JobConfigDraftFilesystem
} from "../services/JobConfigDraftFilesystem";
import { JobConfigDraftManager } from "../services/JobConfigDraftManager";
import { PendingInputRefreshCoordinator } from "../services/PendingInputRefreshCoordinator";
import { QueuedBuildWaiter } from "../services/QueuedBuildWaiter";
import { JenkinsEnvironmentStore } from "../storage/JenkinsEnvironmentStore";
import { JenkinsPinStore } from "../storage/JenkinsPinStore";
import { JenkinsViewStateStore } from "../storage/JenkinsViewStateStore";
import { JenkinsWatchStore } from "../storage/JenkinsWatchStore";
import type { BuildTooltipOptions } from "../tree/BuildTooltips";
import { JenkinsWorkbenchTreeDataProvider, type TreeViewSummary } from "../tree/TreeDataProvider";
import { TreeExpansionState } from "../tree/TreeExpansionState";
import { JenkinsTreeFilter } from "../tree/TreeFilter";
import type { WorkbenchTreeElement } from "../tree/TreeItems";
import { DefaultJenkinsTreeNavigator } from "../tree/TreeNavigator";
import {
  type ArtifactActionHandler,
  type ArtifactActionOptionsProvider,
  DefaultArtifactActionHandler
} from "../ui/ArtifactActionHandler";
import {
  ArtifactPreviewProvider,
  type ArtifactPreviewProviderOptions
} from "../ui/ArtifactPreviewProvider";
import { type ArtifactPreviewOptionsProvider, ArtifactPreviewer } from "../ui/ArtifactPreviewer";
import { BuildLogPreviewer } from "../ui/BuildLogPreviewer";
import { JobConfigPreviewer } from "../ui/JobConfigPreviewer";
import { JenkinsfileEnvironmentResolver } from "../validation/JenkinsfileEnvironmentResolver";
import { JenkinsfileMatcher } from "../validation/JenkinsfileMatcher";
import { JenkinsfileValidationCoordinator } from "../validation/JenkinsfileValidationCoordinator";
import { JenkinsfileValidationStatusBar } from "../validation/JenkinsfileValidationStatusBar";
import type { JenkinsfileValidationConfig } from "../validation/JenkinsfileValidationTypes";

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
  jobConfigDraftManager: JobConfigDraftManager;
  jobConfigUpdateWorkflow: JobConfigUpdateWorkflow;
  artifactActionHandler: ArtifactActionHandler;
  watchStore: JenkinsWatchStore;
  pinStore: JenkinsPinStore;
  viewStateStore: JenkinsViewStateStore;
  treeFilter: JenkinsTreeFilter;
  treeDataProvider: JenkinsWorkbenchTreeDataProvider;
  treeView: vscode.TreeView<WorkbenchTreeElement>;
  treeExpansionState: TreeExpansionState;
  treeNavigator: DefaultJenkinsTreeNavigator;
  jenkinsfileMatcher: JenkinsfileMatcher;
  jenkinsfileEnvironmentResolver: JenkinsfileEnvironmentResolver;
  jenkinsfileValidationCoordinator: JenkinsfileValidationCoordinator;
  jenkinsfileValidationStatusBar: JenkinsfileValidationStatusBar;
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
  jenkinsfileValidationConfig: JenkinsfileValidationConfig;
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
  const jobConfigDraftFilesystem = new JobConfigDraftFilesystem();
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider(JOB_CONFIG_DRAFT_SCHEME, jobConfigDraftFilesystem)
  );
  const jobConfigDraftManager = new JobConfigDraftManager(jobConfigDraftFilesystem);
  context.subscriptions.push(jobConfigDraftManager);
  const jobConfigUpdateWorkflow = new JobConfigUpdateWorkflow(
    dataService,
    jobConfigPreviewer,
    jobConfigDraftManager
  );
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
  const treeExpansionState = new TreeExpansionState(treeView, treeDataProvider);
  const treeSummarySubscription = treeDataProvider.onDidChangeSummary((summary) => {
    const hasCounts = summary.watchErrors > 0 || summary.running > 0 || summary.queue > 0;
    if (!hasCounts) {
      treeView.badge = undefined;
      treeView.message = undefined;
      return;
    }
    const message = formatTreeViewSummaryMessage(summary);
    treeView.message = message;
    const badgeValue = resolveTreeViewBadgeValue(summary);
    treeView.badge = badgeValue > 0 ? { value: badgeValue, tooltip: message } : undefined;
  });
  const treeNavigator = new DefaultJenkinsTreeNavigator(treeView, treeDataProvider);
  const jenkinsfileEnvironmentResolver = new JenkinsfileEnvironmentResolver(
    context,
    environmentStore
  );
  const jenkinsfileMatcher = new JenkinsfileMatcher(
    options.jenkinsfileValidationConfig.filePatterns
  );
  const jenkinsfileValidationStatusBar = new JenkinsfileValidationStatusBar(jenkinsfileMatcher);
  const jenkinsfileValidationCoordinator = new JenkinsfileValidationCoordinator(
    clientProvider,
    jenkinsfileEnvironmentResolver,
    jenkinsfileValidationStatusBar,
    jenkinsfileMatcher,
    options.jenkinsfileValidationConfig
  );
  context.subscriptions.push(treeSummarySubscription);

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
    jobConfigDraftManager,
    jobConfigUpdateWorkflow,
    artifactActionHandler,
    watchStore,
    pinStore,
    viewStateStore,
    treeFilter,
    treeDataProvider,
    treeView,
    treeExpansionState,
    treeNavigator,
    jenkinsfileMatcher,
    jenkinsfileEnvironmentResolver,
    jenkinsfileValidationCoordinator,
    jenkinsfileValidationStatusBar
  };
}

function formatTreeViewSummaryMessage(summary: TreeViewSummary): string {
  return `Running: ${summary.running} | Queue: ${summary.queue} | Watch errors: ${summary.watchErrors}`;
}

function resolveTreeViewBadgeValue(summary: TreeViewSummary): number {
  if (summary.watchErrors > 0) {
    return summary.watchErrors;
  }
  if (summary.running > 0) {
    return summary.running;
  }
  if (summary.queue > 0) {
    return summary.queue;
  }
  return 0;
}
