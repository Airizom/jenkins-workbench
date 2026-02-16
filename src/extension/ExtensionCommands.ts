import type * as vscode from "vscode";
import { registerBuildCommands } from "../commands/BuildCommands";
import { registerEnvironmentCommands } from "../commands/EnvironmentCommands";
import { registerJenkinsfileCommands } from "../commands/JenkinsfileCommands";
import { registerJobCommands } from "../commands/JobCommands";
import { registerNodeCommands } from "../commands/NodeCommands";
import { registerPinCommands } from "../commands/PinCommands";
import { registerQueueCommands } from "../commands/QueueCommands";
import { registerRefreshCommands } from "../commands/RefreshCommands";
import { registerSearchCommands } from "../commands/SearchCommands";
import { registerWatchCommands } from "../commands/WatchCommands";
import type { JobConfigUpdateWorkflow } from "../commands/job/JobConfigUpdateWorkflow";
import type { JenkinsClientProvider } from "../jenkins/JenkinsClientProvider";
import type { JenkinsDataService } from "../jenkins/JenkinsDataService";
import type { BuildConsoleExporter } from "../services/BuildConsoleExporter";
import type { JobConfigDraftManager } from "../services/JobConfigDraftManager";
import type { PendingInputRefreshCoordinator } from "../services/PendingInputRefreshCoordinator";
import type { QueuedBuildWaiter } from "../services/QueuedBuildWaiter";
import type { JenkinsEnvironmentStore } from "../storage/JenkinsEnvironmentStore";
import type { JenkinsPinStore } from "../storage/JenkinsPinStore";
import type { JenkinsViewStateStore } from "../storage/JenkinsViewStateStore";
import type { JenkinsWatchStore } from "../storage/JenkinsWatchStore";
import type { JenkinsWorkbenchTreeDataProvider } from "../tree/TreeDataProvider";
import type { TreeExpansionState } from "../tree/TreeExpansionState";
import type { DefaultJenkinsTreeNavigator } from "../tree/TreeNavigator";
import type { ArtifactActionHandler } from "../ui/ArtifactActionHandler";
import type { BuildLogPreviewer } from "../ui/BuildLogPreviewer";
import type { JobConfigPreviewer } from "../ui/JobConfigPreviewer";
import type { JenkinsfileEnvironmentResolver } from "../validation/JenkinsfileEnvironmentResolver";
import type { JenkinsfileValidationCoordinator } from "../validation/JenkinsfileValidationCoordinator";
import type { ExtensionRefreshHost } from "./ExtensionRefreshHost";

export interface ExtensionCommandDependencies {
  environmentStore: JenkinsEnvironmentStore;
  watchStore: JenkinsWatchStore;
  pinStore: JenkinsPinStore;
  clientProvider: JenkinsClientProvider;
  dataService: JenkinsDataService;
  artifactActionHandler: ArtifactActionHandler;
  buildLogPreviewer: BuildLogPreviewer;
  jobConfigPreviewer: JobConfigPreviewer;
  jobConfigDraftManager: JobConfigDraftManager;
  jobConfigUpdateWorkflow: JobConfigUpdateWorkflow;
  consoleExporter: BuildConsoleExporter;
  queuedBuildWaiter: QueuedBuildWaiter;
  pendingInputCoordinator: PendingInputRefreshCoordinator;
  viewStateStore: JenkinsViewStateStore;
  treeNavigator: DefaultJenkinsTreeNavigator;
  treeDataProvider: JenkinsWorkbenchTreeDataProvider;
  treeExpansionState: TreeExpansionState;
  jenkinsfileEnvironmentResolver: JenkinsfileEnvironmentResolver;
  jenkinsfileValidationCoordinator: JenkinsfileValidationCoordinator;
  refreshHost: ExtensionRefreshHost;
}

export function registerExtensionCommands(
  context: vscode.ExtensionContext,
  dependencies: ExtensionCommandDependencies
): void {
  const refreshHost = dependencies.refreshHost;

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
    dependencies.buildLogPreviewer,
    dependencies.consoleExporter,
    dependencies.queuedBuildWaiter,
    dependencies.pendingInputCoordinator,
    refreshHost
  );

  registerJobCommands(
    context,
    dependencies.dataService,
    dependencies.environmentStore,
    dependencies.jobConfigPreviewer,
    refreshHost,
    dependencies.jobConfigDraftManager,
    dependencies.jobConfigUpdateWorkflow,
    dependencies.pinStore,
    dependencies.watchStore
  );

  registerNodeCommands(context, dependencies.dataService, refreshHost);

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

  registerRefreshCommands(
    context,
    dependencies.treeDataProvider,
    dependencies.treeExpansionState,
    refreshHost
  );

  registerJenkinsfileCommands(
    context,
    dependencies.jenkinsfileValidationCoordinator,
    dependencies.jenkinsfileEnvironmentResolver,
    dependencies.environmentStore
  );
}
