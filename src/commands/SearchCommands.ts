import * as vscode from "vscode";
import { getExtensionConfiguration, getJobSearchTuningOptions } from "../extension/ExtensionConfig";
import { formatError } from "../formatters/ErrorFormatters";
import {
  CancellationError,
  type JenkinsDataService,
  type JobSearchEntry
} from "../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import type { JenkinsEnvironmentStore } from "../storage/JenkinsEnvironmentStore";
import type { JenkinsViewStateStore, JobFilterMode } from "../storage/JenkinsViewStateStore";
import { formatJobColor } from "../tree/formatters";
import { resolveTreeItemLabel } from "../tree/TreeItemLabels";
import type { JenkinsFolderTreeItem } from "../tree/TreeItems";
import type { JenkinsTreeNavigator } from "../tree/TreeNavigator";
import { openExternalHttpUrlWithWarning } from "../ui/OpenExternalUrl";
import { toJenkinsEnvironmentRef } from "./CommandUtils";

type JobQuickPickItem = vscode.QuickPickItem & {
  environment: JenkinsEnvironmentRef;
  entry: JobSearchEntry;
};

const MAX_JOB_RESULTS = 2000;
const BATCH_SIZE = 50;

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
  const environments = await store.listEnvironmentsWithScope();
  if (environments.length === 0) {
    void vscode.window.showInformationMessage("No Jenkins environments configured.");
    return;
  }

  const quickPick = vscode.window.createQuickPick<JobQuickPickItem>();
  const cancellationSource = new vscode.CancellationTokenSource();
  const cancellationToken = cancellationSource.token;
  const picks: JobQuickPickItem[] = [];
  let pending = environments.length;
  let cleanupCompleted = false;

  quickPick.placeholder = "Search jobs across all Jenkins environments";
  quickPick.matchOnDescription = true;
  quickPick.matchOnDetail = true;
  quickPick.busy = true;

  quickPick.onDidAccept(async () => {
    const selection = quickPick.selectedItems[0];
    if (!selection) {
      return;
    }
    quickPick.hide();
    const revealed = await navigator.revealJobPath(selection.environment, selection.entry);
    if (!revealed) {
      await openExternalHttpUrlWithWarning(selection.entry.url, {
        targetLabel: "selected Jenkins job URL"
      });
    }
  });

  quickPick.onDidHide(() => {
    if (cleanupCompleted) {
      return;
    }
    cleanupCompleted = true;
    cancellationSource.cancel();
    cancellationSource.dispose();
    quickPick.dispose();
  });

  quickPick.show();

  const searchOptions = getJobSearchTuningOptions(getExtensionConfiguration());
  const onLoadCompleted = (): void => {
    pending -= 1;
    if (cancellationToken.isCancellationRequested || pending > 0) {
      return;
    }

    quickPick.busy = false;

    if (picks.length === 0) {
      void vscode.window.showInformationMessage("No jobs found with current search settings.");
      return;
    }

    picks.sort((a, b) => a.label.localeCompare(b.label));
    quickPick.items = picks;
  };

  for (const environment of environments) {
    const envRef = toJenkinsEnvironmentRef(environment);
    const seenEntries = new Set<string>();
    const appendEntries = (entries: JobSearchEntry[]): void => {
      if (cancellationToken.isCancellationRequested) {
        return;
      }
      for (const entry of entries) {
        if (seenEntries.has(entry.url)) {
          continue;
        }
        seenEntries.add(entry.url);
        const statusLabel = formatJobColor(entry.color) ?? "Unknown";
        picks.push({
          label: entry.name,
          description: statusLabel,
          detail: `${entry.fullName} • ${envRef.url}`,
          environment: envRef,
          entry
        });
      }
    };
    void (async () => {
      for await (const batch of dataService.iterateJobsForEnvironment(envRef, {
        cancellation: cancellationToken,
        maxResults: MAX_JOB_RESULTS,
        batchSize: BATCH_SIZE,
        ...searchOptions
      })) {
        appendEntries(batch);
      }
    })()
      .catch((error) => {
        if (error instanceof CancellationError || error instanceof vscode.CancellationError) {
          return;
        }
        void vscode.window.showWarningMessage(
          `Unable to load jobs for ${envRef.url}: ${formatError(error)}`
        );
      })
      .finally(onLoadCompleted);
  }
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
      mode: "failing"
    },
    {
      label: "Running Jobs",
      description: currentMode === "running" ? "(current)" : undefined,
      mode: "running"
    }
  ];

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: "Filter jobs by status"
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
