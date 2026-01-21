import type * as vscode from "vscode";
import type { EnvironmentScope } from "./JenkinsEnvironmentStore";

export type WatchStatusKind = "success" | "failure" | "other" | "unknown";

export interface StoredWatchedJobEntry {
  environmentId: string;
  jobUrl: string;
  jobName?: string;
  jobKind?: "job" | "pipeline";
  lastStatus?: WatchStatusKind;
  lastCompletedBuildNumber?: number;
  lastIsBuilding?: boolean;
}

export interface WatchedJobEntry extends StoredWatchedJobEntry {
  scope: EnvironmentScope;
}

const WATCHED_JOBS_KEY = "jenkinsWorkbench.watchedJobs";

export class JenkinsWatchStore {
  constructor(private readonly context: vscode.ExtensionContext) {}

  async listWatchedJobs(): Promise<WatchedJobEntry[]> {
    const [workspace, global] = await Promise.all([
      this.getWatches("workspace"),
      this.getWatches("global")
    ]);
    return [
      ...workspace.map((entry) => ({
        ...entry,
        scope: "workspace" as const
      })),
      ...global.map((entry) => ({
        ...entry,
        scope: "global" as const
      }))
    ];
  }

  async getWatchedJobUrls(scope: EnvironmentScope, environmentId: string): Promise<Set<string>> {
    const entries = await this.getWatches(scope);
    return new Set(
      entries.filter((entry) => entry.environmentId === environmentId).map((entry) => entry.jobUrl)
    );
  }

  async isWatched(
    scope: EnvironmentScope,
    environmentId: string,
    jobUrl: string
  ): Promise<boolean> {
    const entries = await this.getWatches(scope);
    return entries.some(
      (entry) => entry.environmentId === environmentId && entry.jobUrl === jobUrl
    );
  }

  async addWatch(
    scope: EnvironmentScope,
    entry: Omit<StoredWatchedJobEntry, "lastStatus"> & {
      lastStatus?: WatchStatusKind;
    }
  ): Promise<void> {
    const entries = await this.getWatches(scope);
    const index = entries.findIndex(
      (item) => item.environmentId === entry.environmentId && item.jobUrl === entry.jobUrl
    );

    if (index >= 0) {
      const existing = entries[index];
      entries[index] = {
        ...existing,
        jobName: entry.jobName ?? existing.jobName,
        jobKind: entry.jobKind ?? existing.jobKind
      };
    } else {
      entries.push(entry);
    }

    await this.saveWatches(scope, entries);
  }

  async removeWatch(
    scope: EnvironmentScope,
    environmentId: string,
    jobUrl: string
  ): Promise<boolean> {
    const entries = await this.getWatches(scope);
    const next = entries.filter(
      (entry) => entry.environmentId !== environmentId || entry.jobUrl !== jobUrl
    );
    if (next.length === entries.length) {
      return false;
    }
    await this.saveWatches(scope, next);
    return true;
  }

  async updateWatchStatus(
    scope: EnvironmentScope,
    environmentId: string,
    jobUrl: string,
    update: {
      lastStatus?: WatchStatusKind;
      lastCompletedBuildNumber?: number;
      lastIsBuilding?: boolean;
      jobName?: string;
    }
  ): Promise<void> {
    const entries = await this.getWatches(scope);
    let changed = false;
    const next: StoredWatchedJobEntry[] = [];
    for (const entry of entries) {
      if (entry.environmentId !== environmentId || entry.jobUrl !== jobUrl) {
        next.push(entry);
        continue;
      }

      const updated: StoredWatchedJobEntry = { ...entry };
      const shouldUpdateCompleted = typeof update.lastCompletedBuildNumber === "number";
      const shouldUpdateBuilding = typeof update.lastIsBuilding === "boolean";

      if (update.lastStatus !== undefined) {
        updated.lastStatus = update.lastStatus;
      }

      if (shouldUpdateCompleted) {
        updated.lastCompletedBuildNumber = update.lastCompletedBuildNumber;
      }

      if (shouldUpdateBuilding) {
        updated.lastIsBuilding = update.lastIsBuilding;
      }

      if (update.jobName !== undefined) {
        updated.jobName = update.jobName;
      }

      const entryChanged =
        updated.lastStatus !== entry.lastStatus ||
        updated.lastCompletedBuildNumber !== entry.lastCompletedBuildNumber ||
        updated.lastIsBuilding !== entry.lastIsBuilding ||
        updated.jobName !== entry.jobName;
      if (entryChanged) {
        changed = true;
      }

      next.push(updated);
    }

    if (changed) {
      await this.saveWatches(scope, next);
    }
  }

  async removeWatchesForEnvironment(scope: EnvironmentScope, environmentId: string): Promise<void> {
    const entries = await this.getWatches(scope);
    const next = entries.filter((entry) => entry.environmentId !== environmentId);
    if (next.length !== entries.length) {
      await this.saveWatches(scope, next);
    }
  }

  async updateWatchUrl(
    scope: EnvironmentScope,
    environmentId: string,
    oldJobUrl: string,
    newJobUrl: string,
    newJobName?: string
  ): Promise<boolean> {
    const entries = await this.getWatches(scope);
    let found = false;
    const next: StoredWatchedJobEntry[] = [];

    for (const entry of entries) {
      if (entry.environmentId === environmentId && entry.jobUrl === oldJobUrl) {
        found = true;
        next.push({
          ...entry,
          jobUrl: newJobUrl,
          jobName: newJobName ?? entry.jobName
        });
      } else {
        next.push(entry);
      }
    }

    if (found) {
      await this.saveWatches(scope, next);
    }

    return found;
  }

  private getWatches(scope: EnvironmentScope): Promise<StoredWatchedJobEntry[]> {
    const memento = this.getMemento(scope);
    const stored = memento.get<StoredWatchedJobEntry[]>(WATCHED_JOBS_KEY);
    return Promise.resolve(Array.isArray(stored) ? stored : []);
  }

  private async saveWatches(
    scope: EnvironmentScope,
    entries: StoredWatchedJobEntry[]
  ): Promise<void> {
    const memento = this.getMemento(scope);
    await memento.update(WATCHED_JOBS_KEY, entries);
  }

  private getMemento(scope: EnvironmentScope): vscode.Memento {
    return scope === "workspace" ? this.context.workspaceState : this.context.globalState;
  }
}
