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
  const environmentUrlRebaseService = container.lazy("environmentUrlRebaseService");
  const dataService = container.lazy("dataService");
  const artifactActionHandler = container.lazy("artifactActionHandler");
  const buildLogPreviewer = container.lazy("buildLogPreviewer");
  const buildComparePanelLauncher = container.lazy("buildComparePanelLauncher");
  const buildDetailsPanelLauncher = container.lazy("buildDetailsPanelLauncher");
  const buildFollowUpService = container.lazy("buildFollowUpService");
  const buildCompletionTracker = container.lazy("buildCompletionTracker");
  const replayBuildWorkflow = container.lazy("replayBuildWorkflow");
  const localJenkinsfileReplayWorkflow = container.lazy("localJenkinsfileReplayWorkflow");
  const buildManagementWorkflow = container.lazy("buildManagementWorkflow");
  const buildDescriptionDraftManager = container.lazy("buildDescriptionDraftManager");
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
  const bulk = {
    bulkActionService: container.lazy("bulkActionService"),
    treeBulkSelection: container.lazy("treeBulkSelection")
  };

  registerEnvironmentCommands(
    context,
    environmentStore,
    diagnosticBindingStore,
    browserSsoAuthenticator,
    presetStore,
    watchStore,
    pinStore,
    clientProvider,
    environmentUrlRebaseService,
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
    { service: buildFollowUpService, completionTracker: buildCompletionTracker },
    replayBuildWorkflow,
    localJenkinsfileReplayWorkflow,
    refreshHost,
    {
      workflow: buildManagementWorkflow,
      descriptionDraftManager: buildDescriptionDraftManager
    },
    bulk
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

  registerNodeCommands(context, dataService, refreshHost, environmentStore);
  registerNodeCapacityCommands(
    context,
    dataService,
    environmentStore,
    refreshHost,
    buildDetailsPanelLauncher
  );

  registerQueueCommands(context, bulk);

  registerWatchCommands(context, bulk);

  registerPinCommands(context, dataService, pinStore, refreshHost, bulk);

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
