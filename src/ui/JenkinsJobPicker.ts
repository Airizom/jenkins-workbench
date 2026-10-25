import * as vscode from "vscode";
import { getExtensionConfiguration, getJobSearchTuningOptions } from "../extension/ExtensionConfig";
import { formatError } from "../formatters/ErrorFormatters";
import { formatEnvironmentDisplayName } from "../jenkins/EnvironmentLabels";
import {
  CancellationError,
  type JenkinsDataService,
  type JobSearchEntry
} from "../jenkins/JenkinsDataService";
import {
  type JenkinsEnvironmentRef,
  toJenkinsEnvironmentRef
} from "../jenkins/JenkinsEnvironmentRef";
import { normalizeJenkinsUrlForComparison } from "../jenkins/urls";
import type { JenkinsEnvironmentStore } from "../storage/JenkinsEnvironmentStore";
import { formatJobColor } from "../tree/formatters";

export interface JenkinsJobSelection {
  environment: JenkinsEnvironmentRef;
  entry: JobSearchEntry;
}

export interface JenkinsJobPickerOptions {
  filter?: (entry: JobSearchEntry) => boolean;
  suggestion?: Promise<JenkinsJobSelection | undefined>;
  title?: string;
  placeholder?: string;
  noResultsMessage?: string;
  cancellationToken?: vscode.CancellationToken;
}

type JobQuickPickItem = vscode.QuickPickItem & JenkinsJobSelection & { suggested?: boolean };

const MAX_JOB_RESULTS = 2000;
const BATCH_SIZE = 50;

/** Show incremental results without waiting for slower environments or a suggested job. */
export async function pickJenkinsJob(
  dataService: JenkinsDataService,
  store: JenkinsEnvironmentStore,
  options: JenkinsJobPickerOptions = {}
): Promise<JenkinsJobSelection | undefined> {
  // A suggestion may reject before environment discovery has finished.
  const suggestion = options.suggestion?.catch(() => undefined);
  const environments = await store.listEnvironmentsWithScope();
  if (options.cancellationToken?.isCancellationRequested) {
    return undefined;
  }
  if (environments.length === 0) {
    void vscode.window.showInformationMessage("No Jenkins environments configured.");
    return undefined;
  }

  const quickPick = vscode.window.createQuickPick<JobQuickPickItem>();
  const cancellationSource = new vscode.CancellationTokenSource();
  const cancellationToken = cancellationSource.token;
  const picks: JobQuickPickItem[] = [];
  const picksByKey = new Map<string, JobQuickPickItem>();
  const subscriptions: vscode.Disposable[] = [];
  let pending = environments.length + (suggestion ? 1 : 0);
  let settled = false;
  let resolveResult: (selection: JenkinsJobSelection | undefined) => void = () => undefined;
  const result = new Promise<JenkinsJobSelection | undefined>((resolve) => {
    resolveResult = resolve;
  });

  const finish = (selection?: JenkinsJobSelection): void => {
    if (settled) {
      return;
    }
    settled = true;
    cancellationSource.cancel();
    for (const subscription of subscriptions) {
      subscription.dispose();
    }
    cancellationSource.dispose();
    quickPick.hide();
    quickPick.dispose();
    resolveResult(selection);
  };

  quickPick.title = options.title;
  quickPick.placeholder = options.placeholder ?? "Search jobs across all Jenkins environments";
  quickPick.matchOnDescription = true;
  quickPick.matchOnDetail = true;
  quickPick.busy = true;
  subscriptions.push(
    quickPick.onDidAccept(() => {
      const selection = quickPick.selectedItems[0];
      if (selection) {
        finish({ environment: selection.environment, entry: selection.entry });
      }
    }),
    quickPick.onDidHide(() => finish())
  );
  if (options.cancellationToken) {
    subscriptions.push(options.cancellationToken.onCancellationRequested(() => finish()));
  }
  quickPick.show();

  const refreshPicks = (): void => {
    const active = quickPick.activeItems[0];
    picks.sort(
      (left, right) =>
        Number(Boolean(right.suggested)) - Number(Boolean(left.suggested)) ||
        left.label.localeCompare(right.label)
    );
    quickPick.items = [...picks];
    if (active) {
      const restored = picks.find((pick) => selectionKey(pick) === selectionKey(active));
      if (restored) {
        quickPick.activeItems = [restored];
      }
    }
  };

  const appendEntries = (
    environment: JenkinsEnvironmentRef,
    entries: JobSearchEntry[],
    suggested = false
  ): void => {
    if (settled) {
      return;
    }
    let changed = false;
    for (const entry of entries) {
      if (options.filter && !options.filter(entry)) {
        continue;
      }
      const key = selectionKey({ environment, entry });
      const existing = picksByKey.get(key);
      if (existing) {
        if (suggested && !existing.suggested) {
          existing.suggested = true;
          existing.description = `Suggested • ${existing.description}`;
          changed = true;
        }
        continue;
      }
      const statusLabel = formatJobColor(entry.color) ?? "Unknown";
      const pick: JobQuickPickItem = {
        label: entry.name,
        description: suggested ? `Suggested • ${statusLabel}` : statusLabel,
        detail: `${entry.fullName} • ${formatEnvironmentDisplayName(environment)}`,
        environment,
        entry,
        suggested
      };
      picks.push(pick);
      picksByKey.set(key, pick);
      changed = true;
    }
    if (changed) {
      refreshPicks();
    }
  };

  const onLoadCompleted = (): void => {
    pending -= 1;
    if (settled || pending > 0) {
      return;
    }
    quickPick.busy = false;
    if (picks.length === 0) {
      void vscode.window.showInformationMessage(
        options.noResultsMessage ?? "No jobs found with current search settings."
      );
    }
  };

  if (suggestion) {
    void suggestion
      .then((selection) => {
        if (
          selection &&
          environments.some(
            (environment) =>
              environment.id === selection.environment.environmentId &&
              environment.scope === selection.environment.scope
          )
        ) {
          appendEntries(selection.environment, [selection.entry], true);
        }
      })
      .finally(onLoadCompleted);
  }

  const searchOptions = getJobSearchTuningOptions(getExtensionConfiguration());
  for (const environment of environments) {
    const envRef = toJenkinsEnvironmentRef(environment);
    void (async () => {
      for await (const batch of dataService.iterateJobsForEnvironment(envRef, {
        cancellation: cancellationToken,
        maxResults: MAX_JOB_RESULTS,
        batchSize: BATCH_SIZE,
        ...searchOptions
      })) {
        appendEntries(envRef, batch);
      }
    })()
      .catch((error) => {
        if (
          settled ||
          error instanceof CancellationError ||
          error instanceof vscode.CancellationError
        ) {
          return;
        }
        void vscode.window.showWarningMessage(
          `Unable to load jobs for ${envRef.url}: ${formatError(error)}`
        );
      })
      .finally(onLoadCompleted);
  }
  return result;
}

function selectionKey(selection: JenkinsJobSelection): string {
  return JSON.stringify([
    selection.environment.scope,
    selection.environment.environmentId,
    normalizeJenkinsUrlForComparison(selection.entry.url)
  ]);
}
