import * as vscode from "vscode";
import type { EnvironmentScopedRefreshHost } from "../../extension/ExtensionRefreshHost";
import { formatActionError } from "../../formatters/ErrorFormatters";
import type { JenkinsDataService } from "../../jenkins/JenkinsDataService";
import { stripUrlCredentials } from "../../jenkins/urls";
import { createLazyOutputChannel } from "../../shared/LazyOutputChannel";
import type { JenkinsPinStore } from "../../storage/JenkinsPinStore";
import type { JenkinsWatchStore } from "../../storage/JenkinsWatchStore";
import type { WorkbenchTreeElement } from "../../tree/TreeItems";
import { getTreeItemLabel } from "../CommandUtils";
import {
  type BulkAction,
  type BulkActionTarget,
  resolveBulkActionTargets
} from "./BulkActionTargets";

interface BulkActionDependencies {
  dataService: JenkinsDataService;
  watchStore: JenkinsWatchStore;
  pinStore: JenkinsPinStore;
  refreshHost: EnvironmentScopedRefreshHost;
}

type Outcome = "succeeded" | "unchanged" | "failed" | "unattempted" | "incompatible" | "duplicate";
interface Result {
  item: WorkbenchTreeElement;
  outcome: Outcome;
  error?: unknown;
}

const titles: Record<BulkAction, string> = {
  stop: "Stop builds",
  cancel: "Cancel queue items",
  watch: "Watch jobs",
  unwatch: "Unwatch jobs",
  pin: "Pin jobs",
  unpin: "Unpin jobs"
};

function environmentLabel(item: WorkbenchTreeElement): string {
  return "environment" in item
    ? (item.environment.name ?? item.environment.environmentId)
    : "Other tree items";
}

function itemLabel(item: WorkbenchTreeElement): string {
  const label = getTreeItemLabel(item);
  if ("buildUrl" in item) {
    return `${label} (${stripUrlCredentials(item.buildUrl)})`;
  }
  if ("queueId" in item) {
    return `${label} (queue #${item.queueId})`;
  }
  if ("jobUrl" in item) {
    return `${label} (${stripUrlCredentials(item.jobUrl)})`;
  }
  return label;
}

function groupResults(results: readonly Result[]): Map<string, Result[]> {
  const groups = new Map<string, Result[]>();
  for (const result of results) {
    const item = result.item;
    const key =
      "environment" in item
        ? `${environmentLabel(item)} [${item.environment.scope}/${item.environment.environmentId}]`
        : environmentLabel(item);
    const group = groups.get(key) ?? [];
    group.push(result);
    groups.set(key, group);
  }
  return groups;
}

export class BulkActionService implements vscode.Disposable {
  private readonly output = createLazyOutputChannel("Jenkins Bulk Actions");
  private disposed = false;

  constructor(private readonly dependencies: BulkActionDependencies) {}

  dispose(): void {
    this.disposed = true;
    this.output.dispose();
  }

  async run(action: BulkAction, items: readonly WorkbenchTreeElement[]): Promise<void> {
    const { targets, incompatible, duplicates } = resolveBulkActionTargets(action, [...items]);
    const results: Result[] = [
      ...incompatible.map((item): Result => ({ item, outcome: "incompatible" })),
      ...duplicates.map((item): Result => ({ item, outcome: "duplicate" }))
    ];
    if (targets.length === 0) {
      await this.report(action, results, "No eligible items selected");
      return;
    }
    if (
      (action === "stop" || action === "cancel") &&
      !(await this.confirm(action, targets, results.length))
    ) {
      return;
    }

    const refresh = new Set<string>();
    const remote = action === "stop" || action === "cancel";
    let next = 0;
    let completed = 0;
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: titles[action], cancellable: true },
      async (progress, token) => {
        const worker = async (): Promise<void> => {
          while (next < targets.length && !token.isCancellationRequested && !this.disposed) {
            const target = targets[next++];
            let outcome: Outcome = "failed";
            let error: unknown;
            if (remote) {
              refresh.add(target.item.environment.environmentId);
            }
            try {
              outcome = await this.execute(action, target, refresh, token);
            } catch (caught) {
              error = caught;
            }
            results.push({ item: target.item, outcome, error });
            completed++;
            progress.report({
              increment: 100 / targets.length,
              message: `${completed} of ${targets.length}`
            });
          }
        };
        await Promise.all(Array.from({ length: remote ? Math.min(3, targets.length) : 1 }, worker));
        for (const target of targets.slice(next)) {
          results.push({ item: target.item, outcome: "unattempted" });
        }
      }
    );
    for (const environmentId of refresh) {
      this.dependencies.refreshHost.fullEnvironmentRefresh({ environmentId });
    }
    await this.report(action, results);
  }

  private async execute(
    action: BulkAction,
    target: BulkActionTarget,
    refresh: Set<string>,
    token: vscode.CancellationToken
  ): Promise<Outcome> {
    const { dataService } = this.dependencies;
    const { environment } = target.item;
    if (target.kind === "build") {
      await dataService.stopBuild(environment, target.url);
      return "succeeded";
    }
    if (target.kind === "queue") {
      await dataService.cancelQueueItem(environment, target.item.queueId);
      return "succeeded";
    }
    const watching = action === "watch" || action === "unwatch";
    if (action === "watch" || action === "pin") {
      return this.addJobTarget(target, watching, refresh, token);
    }
    return this.removeJobTarget(target, watching, refresh);
  }

  private async addJobTarget(
    target: Extract<BulkActionTarget, { kind: "job" }>,
    watching: boolean,
    refresh: Set<string>,
    token: vscode.CancellationToken
  ): Promise<Outcome> {
    const { watchStore, pinStore } = this.dependencies;
    const { environment } = target.item;
    const present = await Promise.all(
      target.aliases.map((url) =>
        watching
          ? watchStore.isWatched(environment.scope, environment.environmentId, url)
          : pinStore.isPinned(environment.scope, environment.environmentId, url)
      )
    );
    if (present.some(Boolean)) {
      return "unchanged";
    }
    if (token.isCancellationRequested || this.disposed) {
      return "unattempted";
    }
    const entry = {
      environmentId: environment.environmentId,
      jobUrl: target.url,
      jobName: getTreeItemLabel(target.item),
      jobKind: "presentation" in target.item ? target.item.presentation : target.item.jobKind
    };
    if (watching) {
      await watchStore.addWatch(environment.scope, entry);
    } else {
      await pinStore.addPin(environment.scope, entry);
    }
    refresh.add(environment.environmentId);
    return "succeeded";
  }

  private async removeJobTarget(
    target: Extract<BulkActionTarget, { kind: "job" }>,
    watching: boolean,
    refresh: Set<string>
  ): Promise<Outcome> {
    const { watchStore, pinStore } = this.dependencies;
    const { environment } = target.item;
    const removals = await Promise.allSettled(
      target.aliases.map((url) =>
        watching
          ? watchStore.removeWatch(environment.scope, environment.environmentId, url)
          : pinStore.removePin(environment.scope, environment.environmentId, url)
      )
    );
    const removed = removals.some((result) => result.status === "fulfilled" && result.value);
    if (removed) {
      refresh.add(environment.environmentId);
    }
    const errors = removals.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : []
    );
    if (errors.length > 0) {
      throw new Error(
        `Failed to remove ${watching ? "watch" : "pin"} aliases: ${errors.map(formatActionError).join("; ")}`
      );
    }
    return removed ? "succeeded" : "unchanged";
  }

  private async confirm(
    action: BulkAction,
    targets: readonly BulkActionTarget[],
    skipped: number
  ): Promise<boolean> {
    const preview = targets
      .slice(0, 20)
      .map((target): Result => ({ item: target.item, outcome: "unattempted" }));
    const lines: string[] = [];
    for (const [environment, group] of groupResults(preview)) {
      lines.push(environment, ...group.map((result) => `  ${itemLabel(result.item)}`));
    }
    if (targets.length > preview.length) {
      lines.push(`…and ${targets.length - preview.length} more.`);
    }
    if (skipped > 0) {
      lines.push(`${skipped} incompatible or duplicate selected row(s) will be skipped.`);
    }
    const label = action === "stop" ? "Stop Builds" : "Cancel Queue Items";
    const choice = await vscode.window.showWarningMessage(
      `${label}: ${targets.length} eligible item(s)?`,
      { modal: true, detail: lines.join("\n") },
      label
    );
    return choice === label;
  }

  private async report(
    action: BulkAction,
    results: readonly Result[],
    message?: string
  ): Promise<void> {
    const counts = new Map<Outcome, number>();
    for (const result of results) {
      counts.set(result.outcome, (counts.get(result.outcome) ?? 0) + 1);
    }
    const summary = `${titles[action]}: ${message ?? [...counts].map(([outcome, count]) => `${count} ${outcome}`).join(", ")}.`;
    this.output.appendLine(`\n${new Date().toISOString()} — ${summary}`);
    for (const [environment, group] of groupResults(results)) {
      this.output.appendLine(environment);
      for (const result of group) {
        this.output.appendLine(
          `  ${result.outcome}: ${itemLabel(result.item)}${result.error === undefined ? "" : ` — ${formatActionError(result.error)}`}`
        );
      }
    }
    const errors = counts.get("failed") ?? 0;
    const choice =
      errors > 0
        ? (counts.get("succeeded") ?? 0) > 0
          ? await vscode.window.showWarningMessage(summary, "Show Details")
          : await vscode.window.showErrorMessage(summary, "Show Details")
        : await vscode.window.showInformationMessage(summary, "Show Details");
    if (choice === "Show Details") {
      this.output.show(true);
    }
  }
}
