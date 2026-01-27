import * as vscode from "vscode";
import { formatError } from "../formatters/ErrorFormatters";
import {
  CancellationError,
  type JenkinsDataService,
  type JobSearchEntry,
  type JobSearchOptions
} from "../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import type {
  EnvironmentWithScope,
  JenkinsEnvironmentStore
} from "../storage/JenkinsEnvironmentStore";
import type { JenkinsViewStateStore, JobFilterMode } from "../storage/JenkinsViewStateStore";
import type { JenkinsFolderTreeItem } from "../tree/TreeItems";
import type { JenkinsTreeNavigator } from "../tree/TreeNavigator";
import { formatJobColor } from "../tree/formatters";

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
      setJobFilterMode(viewStateStore, "all")
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
  const picks: JobQuickPickItem[] = [];
  let pending = environments.length;

  quickPick.placeholder = "Search jobs across all Jenkins environments";
  quickPick.matchOnDescription = true;
  quickPick.matchOnDetail = true;
  quickPick.busy = true;

  quickPick.onDidAccept(async () => {
    const selection = quickPick.selectedItems.at(0);
    if (!selection) {
      return;
    }
    quickPick.hide();
    const revealed = await revealJobInTree(navigator, selection.environment, selection.entry);
    if (!revealed) {
      await vscode.env.openExternal(vscode.Uri.parse(selection.entry.url));
    }
  });

  quickPick.onDidHide(() => {
    cancellationSource.cancel();
    quickPick.dispose();
  });

  quickPick.show();

  const searchOptions = getJobSearchTuningOptions();

  for (const environment of environments) {
    const envRef = toEnvironmentRef(environment);
    const cancellationToken = cancellationSource.token;
    const seenEntries = new Set<string>();
    const appendEntries = (entries: JobSearchEntry[]): void => {
      if (cancellationSource.token.isCancellationRequested) {
        return;
      }
      for (const entry of entries) {
        const key = `${envRef.environmentId}:${entry.url}`;
        if (seenEntries.has(key)) {
          continue;
        }
        seenEntries.add(key);
        const statusLabel = formatJobColor(entry.color) ?? "Unknown";
        picks.push({
          label: entry.name,
          description: statusLabel,
          detail: `${entry.fullName} • ${envRef.url}`,
          environment: envRef,
          entry
        });
      }
      picks.sort((a, b) => a.label.localeCompare(b.label));
      quickPick.items = picks;
    };
    void loadEnvironmentJobs(dataService, envRef, cancellationToken, searchOptions, appendEntries)
      .then((entries) => {
        appendEntries(entries);
      })
      .catch((error) => {
        if (error instanceof CancellationError || error instanceof vscode.CancellationError) {
          return;
        }
        void vscode.window.showWarningMessage(
          `Unable to load jobs for ${envRef.url}: ${formatError(error)}`
        );
      })
      .finally(() => {
        pending -= 1;
        if (cancellationSource.token.isCancellationRequested) {
          return;
        }
        if (pending <= 0) {
          quickPick.busy = false;
        }
      });
  }
}

async function loadEnvironmentJobs(
  dataService: JenkinsDataService,
  environment: JenkinsEnvironmentRef,
  cancellation: vscode.CancellationToken,
  searchOptions: JobSearchOptions,
  onBatch: (entries: JobSearchEntry[]) => void
): Promise<JobSearchEntry[]> {
  const entries: JobSearchEntry[] = [];
  for await (const batch of dataService.iterateJobsForEnvironment(environment, {
    cancellation,
    maxResults: MAX_JOB_RESULTS,
    batchSize: BATCH_SIZE,
    ...searchOptions
  })) {
    onBatch(batch);
    entries.push(...batch);
  }
  return entries;
}

function getJobSearchTuningOptions(): JobSearchOptions {
  const configuration = vscode.workspace.getConfiguration("jenkinsWorkbench");
  return {
    concurrency: configuration.get<number>("jobSearchConcurrency"),
    backoffBaseMs: configuration.get<number>("jobSearchBackoffBaseMs"),
    backoffMaxMs: configuration.get<number>("jobSearchBackoffMaxMs"),
    maxRetries: configuration.get<number>("jobSearchMaxRetries")
  };
}

function revealJobInTree(
  navigator: JenkinsTreeNavigator,
  environment: JenkinsEnvironmentRef,
  entry: JobSearchEntry
): Promise<boolean> {
  return navigator.revealJobPath(environment, entry);
}

async function setJobFilterMode(
  viewStateStore: JenkinsViewStateStore,
  mode: JobFilterMode
): Promise<void> {
  await viewStateStore.setJobFilterMode(mode);
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

  const folderLabel = getItemLabel(item);
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

function toEnvironmentRef(environment: EnvironmentWithScope): JenkinsEnvironmentRef {
  return {
    environmentId: environment.id,
    scope: environment.scope,
    url: environment.url,
    username: environment.username
  };
}

function getItemLabel(item: vscode.TreeItem): string {
  if (typeof item.label === "string") {
    return item.label;
  }
  if (item.label?.label) {
    return item.label.label;
  }
  return "folder";
}
