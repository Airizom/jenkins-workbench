import * as vscode from "vscode";
import type { HistoryRequest } from "../../history/HistoryService";
import { ensureTrailingSlash } from "../../jenkins/urls";
import type { HistoryDependencies } from "./HistoryController";

type BaselineJobItem = vscode.QuickPickItem & { url: string };

export async function chooseHistoryBaseline(
  panel: vscode.WebviewPanel,
  dependencies: HistoryDependencies,
  request: HistoryRequest,
  reset: boolean
): Promise<boolean> {
  try {
    const project = await dependencies.baseline.project(
      request.environment,
      request.jobUrl,
      request
    );
    if (!request.active()) return false;
    let url: string | undefined;
    if (!reset) {
      const current = dependencies.baseline.store.get(request.environment, project.url);
      url = await pickBaselineJob(panel, dependencies, request, current);
      if (!url) return false;
    }
    if (!request.active()) return false;
    await dependencies.baseline.store.set(request.environment, project.url, url);
    return request.active();
  } catch (error) {
    if (!request.active()) return false;
    throw error;
  }
}

/**
 * Opens the picker immediately in a busy state so the (up to 2000 job) enumeration has visible
 * progress; closing the picker, hiding the panel or changing environments cancels the lookup.
 */
async function pickBaselineJob(
  panel: vscode.WebviewPanel,
  dependencies: HistoryDependencies,
  request: HistoryRequest,
  current: string | undefined
): Promise<string | undefined> {
  const quickPick = vscode.window.createQuickPick<BaselineJobItem>();
  quickPick.title = "Select history baseline job";
  quickPick.placeholder = "Loading Jenkins jobs…";
  quickPick.matchOnDescription = true;
  quickPick.busy = true;
  quickPick.enabled = false;
  let closed = false;
  const listeners: vscode.Disposable[] = [];
  const active = () => !closed && request.active();
  const selection = new Promise<string | undefined>((resolve) => {
    listeners.push(
      quickPick.onDidAccept(() => {
        resolve(quickPick.selectedItems[0]?.url);
        quickPick.hide();
      }),
      quickPick.onDidHide(() => {
        closed = true;
        resolve(undefined);
      })
    );
  });
  const close = () => quickPick.hide();
  listeners.push(
    panel.onDidDispose(close),
    panel.onDidChangeViewState(() => {
      if (!request.active()) close();
    }),
    dependencies.environments.onDidChange(close)
  );
  try {
    quickPick.show();
    const jobs = await dependencies.history
      .run(request, () =>
        dependencies.data.getAllJobsForEnvironment(request.environment, {
          cancellation: () => !active(),
          concurrency: 1,
          maxResults: 2000
        })
      )
      .catch((error: unknown) => {
        // Dismissing the picker cancels the lookup; that is a normal close, not a failure.
        if (closed) return undefined;
        throw error;
      });
    if (!jobs || !active()) return undefined;
    const currentUrl = current ? ensureTrailingSlash(current) : undefined;
    quickPick.items = jobs.map((job) => ({
      label: job.fullName,
      url: job.url,
      description: ensureTrailingSlash(job.url) === currentUrl ? "Current baseline" : undefined
    }));
    quickPick.placeholder = jobs.length
      ? "Type to filter jobs"
      : "No jobs found in this environment";
    quickPick.busy = false;
    quickPick.enabled = true;
    const url = await selection;
    return request.active() ? url : undefined;
  } finally {
    for (const listener of listeners) listener.dispose();
    quickPick.dispose();
  }
}
