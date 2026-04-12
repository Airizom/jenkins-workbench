import * as vscode from "vscode";
import { BuildDetailsPanel } from "../panels/BuildDetailsPanel";
import { NodeDetailsPanel } from "../panels/NodeDetailsPanel";
import { JOB_CONFIG_DRAFT_SCHEME } from "../services/JobConfigDraftFilesystem";
import { REPLAY_DRAFT_SCHEME } from "../services/ReplayDraftFilesystem";
import { registerJenkinsTasks } from "../tasks/JenkinsTasks";
import type { TreeViewSummary } from "../tree/TreeDataProvider";
import { ARTIFACT_PREVIEW_SCHEME } from "../ui/ArtifactPreviewProvider";
import { JenkinsfileQuickFixProvider } from "../validation/editor/JenkinsfileQuickFixProvider";
import { registerExtensionCommands } from "./ExtensionCommands";
import type { ExtensionRuntimeOptions } from "./ExtensionServices";
import { registerExtensionProviders } from "./ExtensionServices";
import { registerExtensionSubscriptions } from "./ExtensionSubscriptions";
import { createExtensionContainer } from "./container/ExtensionContainer";
import { syncJenkinsfileContext, syncNoEnvironmentsContext } from "./contextKeys";

const JENKINSFILE_DOCUMENT_SELECTORS = [
  { scheme: "file" },
  { scheme: "untitled" },
  { scheme: REPLAY_DRAFT_SCHEME }
] as const;

const JENKINSFILE_SIGNATURE_TRIGGER_CHARACTERS = ["(", ",", " ", ":", "'", '"'] as const;

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
  const artifactActionHandler = container.get("artifactActionHandler");
  const consoleExporter = container.get("consoleExporter");
  const pendingInputCoordinator = container.get("pendingInputCoordinator");
  const artifactPreviewProvider = container.get("artifactPreviewProvider");
  const uriHandler = container.get("uriHandler");
  const treeExpansionState = container.get("treeExpansionState");
  const jobConfigDraftManager = container.get("jobConfigDraftManager");
  const jobConfigDraftFilesystem = container.get("jobConfigDraftFilesystem");
  const currentBranchService = container.get("currentBranchService");
  const currentBranchStatusBar = container.get("currentBranchStatusBar");
  const replayDraftManager = container.get("replayDraftManager");
  const replayDraftFilesystem = container.get("replayDraftFilesystem");

  await syncNoEnvironmentsContext(environmentStore);
  void syncJenkinsfileContext(jenkinsfileMatcher);

  const watchErrorSubscription = poller.onDidChangeWatchErrorCount((count) => {
    treeDataProvider.setWatchErrorCount(count);
  });

  const treeSummarySubscription = treeDataProvider.onDidChangeSummary((summary) => {
    applyTreeSummary(treeView, summary);
  });

  const buildDetailsSerializer = vscode.window.registerWebviewPanelSerializer(
    "jenkinsWorkbench.buildDetails",
    {
      deserializeWebviewPanel: async (panel, state) => {
        await BuildDetailsPanel.revive(panel, state, {
          dataService,
          artifactActionHandler,
          consoleExporter,
          refreshHost,
          pendingInputProvider: pendingInputCoordinator,
          environmentStore,
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
          dataService,
          environmentStore,
          extensionUri: context.extensionUri,
          refreshHost
        });
      }
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
  poller.start();
  statusRefreshService.start();
  void viewStateStore.syncFilterContext();
  jenkinsfileValidationCoordinator.start();

  const jenkinsfileQuickFixProvider = container.get("jenkinsfileQuickFixProvider");
  const jenkinsfileHoverProvider = container.get("jenkinsfileHoverProvider");
  const jenkinsfileCodeLensProvider = container.get("jenkinsfileCodeLensProvider");
  const jenkinsfileCompletionProvider = container.get("jenkinsfileCompletionProvider");
  const jenkinsfileSignatureHelpProvider = container.get("jenkinsfileSignatureHelpProvider");

  context.subscriptions.push(
    treeView,
    treeDataProvider,
    treeExpansionState,
    pendingInputCoordinator,
    jobConfigDraftManager,
    replayDraftManager,
    treeSummarySubscription,
    jobConfigDraftFilesystemRegistration,
    replayDraftFilesystemRegistration,
    buildDetailsSerializer,
    nodeDetailsSerializer,
    vscode.window.registerUriHandler(uriHandler),
    jenkinsfileCodeLensProvider,
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
    currentBranchStatusBar,
    jenkinsfileValidationCoordinator,
    container.get("jenkinsfileValidationStatusBar"),
    vscode.languages.registerCodeActionsProvider(
      JENKINSFILE_DOCUMENT_SELECTORS,
      jenkinsfileQuickFixProvider,
      { providedCodeActionKinds: JenkinsfileQuickFixProvider.providedCodeActionKinds }
    ),
    vscode.languages.registerHoverProvider(
      JENKINSFILE_DOCUMENT_SELECTORS,
      jenkinsfileHoverProvider
    ),
    vscode.languages.registerCompletionItemProvider(
      JENKINSFILE_DOCUMENT_SELECTORS,
      jenkinsfileCompletionProvider
    ),
    vscode.languages.registerSignatureHelpProvider(
      JENKINSFILE_DOCUMENT_SELECTORS,
      jenkinsfileSignatureHelpProvider,
      ...JENKINSFILE_SIGNATURE_TRIGGER_CHARACTERS
    ),
    vscode.languages.registerCodeLensProvider(
      JENKINSFILE_DOCUMENT_SELECTORS,
      jenkinsfileCodeLensProvider
    )
  );

  registerExtensionSubscriptions(context, container);
  registerExtensionCommands(context, container);
  registerJenkinsTasks(context, container);
}

function applyTreeSummary(treeView: vscode.TreeView<unknown>, summary: TreeViewSummary): void {
  const hasCounts = summary.watchErrors > 0 || summary.running > 0 || summary.queue > 0;
  if (!hasCounts) {
    treeView.badge = undefined;
    treeView.message = undefined;
    return;
  }

  const message = `Running: ${summary.running} | Queue: ${summary.queue} | Watch errors: ${summary.watchErrors}`;
  treeView.message = message;
  const badgeValue = resolveTreeViewBadgeValue(summary);
  treeView.badge = badgeValue > 0 ? { value: badgeValue, tooltip: message } : undefined;
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
