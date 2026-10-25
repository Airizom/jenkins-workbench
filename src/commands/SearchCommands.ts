import * as vscode from "vscode";
import { formatError } from "../formatters/ErrorFormatters";
import type { JenkinsDataService } from "../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentStore } from "../storage/JenkinsEnvironmentStore";
import type { JenkinsViewStateStore, JobFilterMode } from "../storage/JenkinsViewStateStore";
import { resolveTreeItemLabel } from "../tree/TreeItemLabels";
import type { JenkinsFolderTreeItem } from "../tree/TreeItems";
import type { JenkinsTreeNavigator } from "../tree/TreeNavigator";
import { pickJenkinsJob } from "../ui/JenkinsJobPicker";
import { openExternalHttpUrlWithWarning } from "../ui/OpenExternalUrl";

export function registerSearchCommands(
  context: vscode.ExtensionContext,
  store: JenkinsEnvironmentStore,
  dataService: JenkinsDataService,
  viewStateStore: JenkinsViewStateStore,
  navigator: JenkinsTreeNavigator
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("jenkinsWorkbench.goToJob", () =>
      goToJob(store, dataService, navigator)
    ),
    vscode.commands.registerCommand("jenkinsWorkbench.filterJobsAll", () =>
      viewStateStore.setJobFilterMode("all")
    ),
    vscode.commands.registerCommand("jenkinsWorkbench.filterJobsFailing", () =>
      toggleJobFilterMode(viewStateStore, "failing")
    ),
    vscode.commands.registerCommand("jenkinsWorkbench.filterJobsRunning", () =>
      toggleJobFilterMode(viewStateStore, "running")
    ),
    vscode.commands.registerCommand("jenkinsWorkbench.filterJobs", () =>
      promptJobFilter(viewStateStore)
    ),
    vscode.commands.registerCommand("jenkinsWorkbench.filterJobsActive", () =>
      promptJobFilter(viewStateStore)
    ),
    vscode.commands.registerCommand(
      "jenkinsWorkbench.filterBranches",
      (item?: JenkinsFolderTreeItem) => promptBranchFilter(viewStateStore, item)
    ),
    vscode.commands.registerCommand(
      "jenkinsWorkbench.clearBranchFilter",
      (item?: JenkinsFolderTreeItem) => clearBranchFilter(viewStateStore, item)
    )
  );
}

async function goToJob(
  store: JenkinsEnvironmentStore,
  dataService: JenkinsDataService,
  navigator: JenkinsTreeNavigator
): Promise<void> {
  void pickJenkinsJob(dataService, store)
    .then(async (selection) => {
      if (!selection) {
        return;
      }
      const revealed = await navigator.revealJobPath(selection.environment, selection.entry);
      if (!revealed) {
        await openExternalHttpUrlWithWarning(selection.entry.url, {
          targetLabel: "selected Jenkins job URL"
        });
      }
    })
    .catch((error) => {
      void vscode.window.showWarningMessage(`Unable to go to Jenkins job: ${formatError(error)}`);
    });
}

async function toggleJobFilterMode(
  viewStateStore: JenkinsViewStateStore,
  mode: JobFilterMode
): Promise<void> {
  const current = viewStateStore.getJobFilterMode();
  const next = current === mode ? "all" : mode;
  await viewStateStore.setJobFilterMode(next);
}

type FilterQuickPickItem = vscode.QuickPickItem & { mode: JobFilterMode };

async function promptJobFilter(viewStateStore: JenkinsViewStateStore): Promise<void> {
  const currentMode = viewStateStore.getJobFilterMode();

  const items: FilterQuickPickItem[] = [
    {
      label: "All Jobs",
      description: currentMode === "all" ? "(current)" : undefined,
      mode: "all"
    },
    {
      label: "Failing Jobs",
      description: currentMode === "failing" ? "(current)" : undefined,
      detail: "Jobs whose last build failed. Unstable jobs are listed under Activity.",
      mode: "failing"
    },
    {
      label: "Running Jobs",
      description: currentMode === "running" ? "(current)" : undefined,
      detail: "Jobs with a build in progress.",
      mode: "running"
    }
  ];

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: "Filter jobs by status (folders stay visible)"
  });

  if (selected) {
    await viewStateStore.setJobFilterMode(selected.mode);
  }
}

async function promptBranchFilter(
  viewStateStore: JenkinsViewStateStore,
  item?: JenkinsFolderTreeItem
): Promise<void> {
  if (item?.folderKind !== "multibranch") {
    void vscode.window.showInformationMessage("Select a multibranch folder to filter.");
    return;
  }

  const folderLabel = resolveTreeItemLabel(item) ?? "folder";
  const existing =
    viewStateStore.getBranchFilter(item.environment.environmentId, item.folderUrl) ?? "";
  const input = await vscode.window.showInputBox({
    prompt: `Filter branches in ${folderLabel} (leave blank to clear)`,
    placeHolder: "Type part of a branch name",
    value: existing
  });

  if (input === undefined) {
    return;
  }

  await viewStateStore.setBranchFilter(item.environment.environmentId, item.folderUrl, input);
}

async function clearBranchFilter(
  viewStateStore: JenkinsViewStateStore,
  item?: JenkinsFolderTreeItem
): Promise<void> {
  if (item?.folderKind !== "multibranch") {
    void vscode.window.showInformationMessage(
      "Select a multibranch folder to clear its branch filter."
    );
    return;
  }

  const existing = viewStateStore.getBranchFilter(item.environment.environmentId, item.folderUrl);
  if (!existing) {
    void vscode.window.showInformationMessage("No branch filter is set for this folder.");
    return;
  }

  await viewStateStore.clearBranchFilter(item.environment.environmentId, item.folderUrl);
}
