import type * as vscode from "vscode";
import { registerBuildCommands } from "../commands/BuildCommands";
import { registerBuildDiagnosticCommands } from "../commands/BuildDiagnosticCommands";
import { registerCurrentBranchCommands } from "../commands/CurrentBranchCommands";
import { registerEnvironmentCommands } from "../commands/EnvironmentCommands";
import { registerHistoryCommands } from "../commands/HistoryCommands";
import { registerJenkinsfileCommands } from "../commands/JenkinsfileCommands";
import { registerJobCommands } from "../commands/JobCommands";
import { registerNodeCapacityCommands } from "../commands/NodeCapacityCommands";
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
  // Command handlers capture lazy references; services are built when a command first runs.
  const environmentStore = container.lazy("environmentStore");
  const browserSsoAuthenticator = container.lazy("browserSsoAuthenticator");
  const presetStore = container.lazy("presetStore");
  const watchStore = container.lazy("watchStore");
  const pinStore = container.lazy("pinStore");
  const clientProvider = container.lazy("clientProvider");
  const dataService = container.lazy("dataService");
  const artifactActionHandler = container.lazy("artifactActionHandler");
  const buildLogPreviewer = container.lazy("buildLogPreviewer");
  const buildComparePanelLauncher = container.lazy("buildComparePanelLauncher");
  const buildDetailsPanelLauncher = container.lazy("buildDetailsPanelLauncher");
  const queuedBuildWaiter = container.lazy("queuedBuildWaiter");
  const replayBuildWorkflow = container.lazy("replayBuildWorkflow");
  const viewStateStore = container.lazy("viewStateStore");
  const treeNavigator = container.lazy("treeNavigator");
  const treeDataProvider = container.lazy("treeDataProvider");
  const treeExpansionState = container.lazy("treeExpansionState");
  const jenkinsfileValidationCoordinator = container.lazy("jenkinsfileValidationCoordinator");
  const jenkinsfileEnvironmentResolver = container.lazy("jenkinsfileEnvironmentResolver");
  const jenkinsfileStepCatalogService = container.lazy("jenkinsfileStepCatalogService");
  const jobConfigPreviewer = container.lazy("jobConfigPreviewer");
  const workspacePreviewer = container.lazy("workspacePreviewer");
  const jobConfigDraftManager = container.lazy("jobConfigDraftManager");
  const jobConfigUpdateWorkflow = container.lazy("jobConfigUpdateWorkflow");
  const refreshHost = container.lazy("refreshHost");
  const currentBranchWorkflowService = container.lazy("currentBranchWorkflowService");
  const diagnosticBindingStore = container.lazy("diagnosticBindingStore");
  const buildDiagnosticsCoordinator = container.lazy("buildDiagnosticsCoordinator");

  registerEnvironmentCommands(
    context,
    environmentStore,
    diagnosticBindingStore,
    browserSsoAuthenticator,
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
    buildComparePanelLauncher,
    buildDetailsPanelLauncher,
    queuedBuildWaiter,
    replayBuildWorkflow,
    refreshHost
  );

  registerCurrentBranchCommands(context, currentBranchWorkflowService);
  registerHistoryCommands(
    context,
    dataService,
    environmentStore,
    container.lazy("jobHistoryPanelLauncher")
  );

  registerJobCommands(
    context,
    dataService,
    environmentStore,
    jobConfigPreviewer,
    workspacePreviewer,
    refreshHost,
    jobConfigDraftManager,
    jobConfigUpdateWorkflow,
    presetStore,
    pinStore,
    watchStore,
    diagnosticBindingStore
  );

  registerBuildDiagnosticCommands(context, buildDiagnosticsCoordinator);

  registerNodeCommands(context, dataService, refreshHost);
  registerNodeCapacityCommands(context, dataService, environmentStore, refreshHost);

  registerQueueCommands(context, dataService, refreshHost);

  registerWatchCommands(context, watchStore, refreshHost);

  registerPinCommands(context, dataService, pinStore, refreshHost);

  registerSearchCommands(context, environmentStore, dataService, viewStateStore, treeNavigator);

  registerRefreshCommands(context, treeDataProvider, treeExpansionState, refreshHost);

  registerJenkinsfileCommands(
    context,
    jenkinsfileValidationCoordinator,
    jenkinsfileEnvironmentResolver,
    environmentStore,
    jenkinsfileStepCatalogService
  );
}
