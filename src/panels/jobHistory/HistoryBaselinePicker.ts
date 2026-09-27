import * as vscode from "vscode";
import type { HistoryRequest } from "../../history/HistoryService";
import type { HistoryDependencies } from "./HistoryController";

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
      const jobs = await dependencies.history.run(request, () =>
        dependencies.data.getAllJobsForEnvironment(request.environment, {
          cancellation: () => !request.active(),
          concurrency: 1,
          maxResults: 2000
        })
      );
      if (!request.active()) return false;
      const cancellation = new vscode.CancellationTokenSource();
      const listeners = [
        panel.onDidDispose(() => cancellation.cancel()),
        panel.onDidChangeViewState(() => {
          if (!request.active()) cancellation.cancel();
        }),
        dependencies.environments.onDidChange(() => cancellation.cancel())
      ];
      try {
        const selected = await vscode.window.showQuickPick(
          jobs.map((job) => ({ label: job.fullName, url: job.url })),
          { title: "Select history baseline job", matchOnDescription: true },
          cancellation.token
        );
        if (!selected || !request.active()) return false;
        url = selected.url;
      } finally {
        for (const listener of listeners) listener.dispose();
        cancellation.dispose();
      }
    }
    if (!request.active()) return false;
    await dependencies.baseline.store.set(request.environment, project.url, url);
    return request.active();
  } catch (error) {
    if (!request.active()) return false;
    throw error;
  }
}
