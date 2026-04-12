import type * as vscode from "vscode";
import { registerBuildCommands } from "../commands/BuildCommands";
import { registerCurrentBranchCommands } from "../commands/CurrentBranchCommands";
import { registerEnvironmentCommands } from "../commands/EnvironmentCommands";
import { registerJenkinsfileCommands } from "../commands/JenkinsfileCommands";
import { registerJobCommands } from "../commands/JobCommands";
import { registerNodeCommands } from "../commands/NodeCommands";
import { registerPinCommands } from "../commands/PinCommands";
import { registerQueueCommands } from "../commands/QueueCommands";
import { registerRefreshCommands } from "../commands/RefreshCommands";
import { registerSearchCommands } from "../commands/SearchCommands";
import { registerWatchCommands } from "../commands/WatchCommands";
import type { ExtensionContainer } from "./container/ExtensionContainer";

export function registerExtensionCommands(
  context: vscode.ExtensionContext,
  container: ExtensionContainer
): void {
  const environmentStore = container.get("environmentStore");
  const presetStore = container.get("presetStore");
  const watchStore = container.get("watchStore");
  const pinStore = container.get("pinStore");
  const clientProvider = container.get("clientProvider");
  const dataService = container.get("dataService");
  const artifactActionHandler = container.get("artifactActionHandler");
  const buildLogPreviewer = container.get("buildLogPreviewer");
  const consoleExporter = container.get("consoleExporter");
  const queuedBuildWaiter = container.get("queuedBuildWaiter");
  const pendingInputCoordinator = container.get("pendingInputCoordinator");
  const replayBuildWorkflow = container.get("replayBuildWorkflow");
  const viewStateStore = container.get("viewStateStore");
  const treeNavigator = container.get("treeNavigator");
  const treeDataProvider = container.get("treeDataProvider");
  const treeExpansionState = container.get("treeExpansionState");
  const jenkinsfileValidationCoordinator = container.get("jenkinsfileValidationCoordinator");
  const jenkinsfileEnvironmentResolver = container.get("jenkinsfileEnvironmentResolver");
  const jobConfigPreviewer = container.get("jobConfigPreviewer");
  const jobConfigDraftManager = container.get("jobConfigDraftManager");
  const jobConfigUpdateWorkflow = container.get("jobConfigUpdateWorkflow");
  const refreshHost = container.get("refreshHost");
  const currentBranchWorkflowService = container.get("currentBranchWorkflowService");

  registerEnvironmentCommands(
    context,
    environmentStore,
    presetStore,
    watchStore,
    pinStore,
    clientProvider,
    refreshHost
  );

  registerBuildCommands(
    context,
    dataService,
    presetStore,
    artifactActionHandler,
    buildLogPreviewer,
    consoleExporter,
    queuedBuildWaiter,
    pendingInputCoordinator,
    replayBuildWorkflow,
    refreshHost
  );

  registerCurrentBranchCommands(context, currentBranchWorkflowService);

  registerJobCommands(
    context,
    dataService,
    environmentStore,
    jobConfigPreviewer,
    refreshHost,
    jobConfigDraftManager,
    jobConfigUpdateWorkflow,
    presetStore,
    pinStore,
    watchStore
  );

  registerNodeCommands(context, dataService, refreshHost);

  registerQueueCommands(context, dataService, refreshHost);

  registerWatchCommands(context, watchStore, refreshHost);

  registerPinCommands(context, dataService, pinStore, refreshHost);

  registerSearchCommands(context, environmentStore, dataService, viewStateStore, treeNavigator);

  registerRefreshCommands(context, treeDataProvider, treeExpansionState, refreshHost);

  registerJenkinsfileCommands(
    context,
    jenkinsfileValidationCoordinator,
    jenkinsfileEnvironmentResolver,
    environmentStore
  );
}
