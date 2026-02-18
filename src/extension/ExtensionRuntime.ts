import * as vscode from "vscode";
import { BuildDetailsPanel } from "../panels/BuildDetailsPanel";
import { NodeDetailsPanel } from "../panels/NodeDetailsPanel";
import { JOB_CONFIG_DRAFT_SCHEME } from "../services/JobConfigDraftFilesystem";
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

export async function activateRuntime(
  context: vscode.ExtensionContext,
  options: ExtensionRuntimeOptions
): Promise<void> {
  const container = createExtensionContainer((registry) => {
    registerExtensionProviders(registry, context, options);
  });

  const environmentStore = container.get("environmentStore");
  try {
    await environmentStore.migrateLegacyAuthConfigs();
  } catch (error) {
    console.warn("Failed to migrate legacy Jenkins auth config.", error);
  }

  const treeDataProvider = container.get("treeDataProvider");
  const treeView = container.get("treeView");
  const poller = container.get("poller");
  const queuePoller = container.get("queuePoller");
  const viewStateStore = container.get("viewStateStore");
  const refreshHost = container.get("refreshHost");
  const jenkinsfileMatcher = container.get("jenkinsfileMatcher");
  const jenkinsfileValidationCoordinator = container.get("jenkinsfileValidationCoordinator");

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
          dataService: container.get("dataService"),
          artifactActionHandler: container.get("artifactActionHandler"),
          consoleExporter: container.get("consoleExporter"),
          refreshHost,
          pendingInputProvider: container.get("pendingInputCoordinator"),
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
          dataService: container.get("dataService"),
          environmentStore,
          extensionUri: context.extensionUri,
          refreshHost
        });
      }
    }
  );

  const jobConfigDraftFilesystemRegistration = vscode.workspace.registerFileSystemProvider(
    JOB_CONFIG_DRAFT_SCHEME,
    container.get("jobConfigDraftFilesystem")
  );

  poller.start();
  void viewStateStore.syncFilterContext();
  jenkinsfileValidationCoordinator.start();

  const jenkinsfileQuickFixProvider = container.get("jenkinsfileQuickFixProvider");
  const jenkinsfileHoverProvider = container.get("jenkinsfileHoverProvider");
  const jenkinsfileCodeLensProvider = container.get("jenkinsfileCodeLensProvider");

  context.subscriptions.push(
    treeView,
    treeDataProvider,
    container.get("treeExpansionState"),
    container.get("pendingInputCoordinator"),
    container.get("jobConfigDraftManager"),
    treeSummarySubscription,
    jobConfigDraftFilesystemRegistration,
    buildDetailsSerializer,
    nodeDetailsSerializer,
    vscode.window.registerUriHandler(container.get("uriHandler")),
    jenkinsfileCodeLensProvider,
    vscode.workspace.registerFileSystemProvider(
      ARTIFACT_PREVIEW_SCHEME,
      container.get("artifactPreviewProvider"),
      { isReadonly: true }
    ),
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
      container.get("artifactPreviewProvider").release(document.uri);
    }),
    poller,
    queuePoller,
    watchErrorSubscription,
    jenkinsfileValidationCoordinator,
    container.get("jenkinsfileValidationStatusBar"),
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
