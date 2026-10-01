import * as vscode from "vscode";
import { NodeCapacityPanel } from "../panels/NodeCapacityPanel";
import { NodeDetailsPanel } from "../panels/NodeDetailsPanel";
import { JOB_CONFIG_DRAFT_SCHEME } from "../services/JobConfigDraftFilesystem";
import { REPLAY_DRAFT_SCHEME } from "../services/ReplayDraftFilesystem";
import { registerJenkinsTasks } from "../tasks/JenkinsTasks";
import type { TreeViewSummary } from "../tree/TreeDataProvider";
import { formatJobFilterDescription, formatTreeViewSummary } from "../tree/TreeViewPresentation";
import { ARTIFACT_PREVIEW_SCHEME } from "../ui/ArtifactPreviewProvider";
import { createExtensionContainer } from "./container/ExtensionContainer";
import { syncJenkinsfileContext, syncNoEnvironmentsContext } from "./contextKeys";
import { registerExtensionCommands } from "./ExtensionCommands";
import type { ExtensionRuntimeOptions } from "./ExtensionServices";
import { registerExtensionProviders } from "./ExtensionServices";
import { registerExtensionSubscriptions } from "./ExtensionSubscriptions";
import { registerJenkinsfileLanguageFeatures } from "./JenkinsfileLanguageFeatures";

// Background Jenkins polls wait until the window has settled; staggered so they do not
// contend with each other or with restored panels for the same servers.
const WATCH_POLL_STARTUP_DELAY_MS = 5_000;
const COMMIT_WATCH_POLL_STARTUP_DELAY_MS = 8_000;

export async function activateRuntime(
  context: vscode.ExtensionContext,
  options: ExtensionRuntimeOptions
): Promise<void> {
  const container = createExtensionContainer((registry) => {
    registerExtensionProviders(registry, context, options);
  });

  const environmentStore = container.get("environmentStore");
  const repositoryLinkStore = container.get("repositoryLinkStore");
  try {
    await environmentStore.migrateLegacyAuthConfigs();
  } catch (error) {
    console.warn("Failed to migrate legacy Jenkins auth config.", error);
  }
  try {
    await repositoryLinkStore.migrateLegacyWorkspaceLinks();
  } catch (error) {
    console.warn("Failed to migrate legacy Jenkins repository links.", error);
  }

  const treeDataProvider = container.get("treeDataProvider");
  const treeView = container.get("treeView");
  const poller = container.get("poller");
  const queuePoller = container.get("queuePoller");
  const statusRefreshService = container.get("statusRefreshService");
  const viewStateStore = container.get("viewStateStore");
  const refreshHost = container.get("refreshHost");
  const jenkinsfileMatcher = container.get("jenkinsfileMatcher");
  const jenkinsfileValidationCoordinator = container.get("jenkinsfileValidationCoordinator");
  const dataService = container.get("dataService");
  const pendingInputCoordinator = container.get("pendingInputCoordinator");
  const artifactPreviewProvider = container.get("artifactPreviewProvider");
  const uriHandler = container.get("uriHandler");
  const treeExpansionState = container.get("treeExpansionState");
  const jobConfigDraftManager = container.get("jobConfigDraftManager");
  const jobConfigDraftFilesystem = container.get("jobConfigDraftFilesystem");
  const currentBranchService = container.get("currentBranchService");
  const commitWatchService = container.get("commitWatchService");
  const currentBranchStatusBar = container.get("currentBranchStatusBar");
  const replayDraftManager = container.get("replayDraftManager");
  const replayDraftFilesystem = container.get("replayDraftFilesystem");
  const buildDiagnosticsCoordinator = container.get("buildDiagnosticsCoordinator");

  await syncNoEnvironmentsContext(environmentStore);
  void syncJenkinsfileContext(jenkinsfileMatcher);

  const watchErrorSubscription = poller.onDidChangeWatchErrorCount((count) => {
    treeDataProvider.setWatchErrorCount(count);
  });

  const treeSummarySubscription = treeDataProvider.onDidChangeSummary((summary) => {
    applyTreeSummary(treeView, summary);
  });

  const applyJobFilterDescription = (): void => {
    treeView.description = formatJobFilterDescription(viewStateStore.getJobFilterMode());
  };
  applyJobFilterDescription();
  const jobFilterDescriptionSubscription = viewStateStore.onDidChange(applyJobFilterDescription);

  const buildDetailsSerializer = vscode.window.registerWebviewPanelSerializer(
    "jenkinsWorkbench.buildDetails",
    {
      deserializeWebviewPanel: (panel, state) =>
        container.get("buildDetailsPanelLauncher").revive(panel, state)
    }
  );
  context.subscriptions.push(
    vscode.window.registerWebviewPanelSerializer("jenkinsWorkbench.jobHistory", {
      deserializeWebviewPanel: (panel, state) =>
        container.get("jobHistoryPanelLauncher").revive(panel, state)
    })
  );

  const nodeDetailsSerializer = vscode.window.registerWebviewPanelSerializer(
    "jenkinsWorkbench.nodeDetails",
    {
      deserializeWebviewPanel: async (panel, state) => {
        await NodeDetailsPanel.revive(panel, state, {
          dataService,
          environmentStore,
          extensionUri: context.extensionUri,
          refreshHost
        });
      }
    }
  );

  const nodeCapacitySerializer = vscode.window.registerWebviewPanelSerializer(
    "jenkinsWorkbench.nodeCapacity",
    {
      deserializeWebviewPanel: async (panel, state) => {
        await NodeCapacityPanel.revive(panel, state, {
          dataService,
          environmentStore,
          extensionUri: context.extensionUri,
          refreshHost
        });
      }
    }
  );

  const buildCompareSerializer = vscode.window.registerWebviewPanelSerializer(
    "jenkinsWorkbench.buildCompare",
    {
      deserializeWebviewPanel: (panel, state) =>
        container.get("buildComparePanelLauncher").revive(panel, state)
    }
  );

  const jobConfigDraftFilesystemRegistration = vscode.workspace.registerFileSystemProvider(
    JOB_CONFIG_DRAFT_SCHEME,
    jobConfigDraftFilesystem
  );
  const replayDraftFilesystemRegistration = vscode.workspace.registerFileSystemProvider(
    REPLAY_DRAFT_SCHEME,
    replayDraftFilesystem
  );

  void currentBranchService.start().catch((error) => {
    console.warn("Failed to initialize current-branch state.", error);
  });
  buildDiagnosticsCoordinator.start();
  commitWatchService.start({ initialDelayMs: COMMIT_WATCH_POLL_STARTUP_DELAY_MS });
  poller.start({ initialDelayMs: WATCH_POLL_STARTUP_DELAY_MS });
  statusRefreshService.start();
  void viewStateStore.syncFilterContext();
  jenkinsfileValidationCoordinator.start();

  const jenkinsfileCodeLensProvider = container.get("jenkinsfileCodeLensProvider");

  context.subscriptions.push(
    treeView,
    treeDataProvider,
    treeExpansionState,
    pendingInputCoordinator,
    jobConfigDraftManager,
    replayDraftManager,
    buildDiagnosticsCoordinator,
    treeSummarySubscription,
    jobFilterDescriptionSubscription,
    jobConfigDraftFilesystemRegistration,
    replayDraftFilesystemRegistration,
    buildCompareSerializer,
    buildDetailsSerializer,
    nodeCapacitySerializer,
    nodeDetailsSerializer,
    vscode.window.registerUriHandler(uriHandler),
    jenkinsfileCodeLensProvider,
    artifactPreviewProvider,
    vscode.workspace.registerFileSystemProvider(ARTIFACT_PREVIEW_SCHEME, artifactPreviewProvider, {
      isReadonly: true
    }),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      void syncJenkinsfileContext(jenkinsfileMatcher, editor);
    }),
    vscode.workspace.onDidSaveTextDocument(() => {
      void syncJenkinsfileContext(jenkinsfileMatcher);
    }),
    vscode.workspace.onDidRenameFiles(() => {
      void syncJenkinsfileContext(jenkinsfileMatcher);
    }),
    vscode.workspace.onDidCloseTextDocument((document) => {
      if (document.uri.scheme !== ARTIFACT_PREVIEW_SCHEME) {
        return;
      }
      artifactPreviewProvider.release(document.uri);
    }),
    poller,
    queuePoller,
    statusRefreshService,
    watchErrorSubscription,
    currentBranchService,
    commitWatchService,
    currentBranchStatusBar,
    jenkinsfileValidationCoordinator,
    container.get("jenkinsfileValidationStatusBar"),
    registerJenkinsfileLanguageFeatures(jenkinsfileMatcher, {
      quickFix: container.get("jenkinsfileQuickFixProvider"),
      hover: container.get("jenkinsfileHoverProvider"),
      completion: container.get("jenkinsfileCompletionProvider"),
      signatureHelp: container.get("jenkinsfileSignatureHelpProvider"),
      codeLens: jenkinsfileCodeLensProvider
    }),
    jenkinsfileMatcher
  );

  registerExtensionSubscriptions(context, container);
  registerExtensionCommands(context, container);
  registerJenkinsTasks(context, container);
}

function applyTreeSummary(treeView: vscode.TreeView<unknown>, summary: TreeViewSummary): void {
  const presentation = formatTreeViewSummary(summary);
  treeView.message = presentation.message;
  treeView.badge = presentation.badge;
}
