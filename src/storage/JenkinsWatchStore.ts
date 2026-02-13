import type * as vscode from "vscode";
import type { EnvironmentScope } from "./JenkinsEnvironmentStore";
import { JenkinsScopedJobStore, type ScopedJobStoreEntry } from "./ScopedJobStore";

export type WatchStatusKind = "success" | "failure" | "other" | "unknown";

export interface StoredWatchedJobEntry extends ScopedJobStoreEntry {
  lastStatus?: WatchStatusKind;
  lastCompletedBuildNumber?: number;
  lastIsBuilding?: boolean;
}

export interface WatchedJobEntry extends StoredWatchedJobEntry {
  scope: EnvironmentScope;
}

const WATCHED_JOBS_KEY = "jenkinsWorkbench.watchedJobs";

type WatchUpdateInput = Omit<StoredWatchedJobEntry, "lastStatus"> & {
  lastStatus?: WatchStatusKind;
};

export class JenkinsWatchStore extends JenkinsScopedJobStore<StoredWatchedJobEntry> {
  constructor(context: vscode.ExtensionContext) {
    super(context, WATCHED_JOBS_KEY);
  }

  async listWatchedJobs(): Promise<WatchedJobEntry[]> {
    return this.listWithScope((scope, entry) => ({ ...entry, scope }));
  }

  async getWatchedJobUrls(scope: EnvironmentScope, environmentId: string): Promise<Set<string>> {
    return this.getJobUrls(scope, environmentId);
  }

  async isWatched(
    scope: EnvironmentScope,
    environmentId: string,
    jobUrl: string
  ): Promise<boolean> {
    return this.isTracked(scope, environmentId, jobUrl);
  }

  async addWatch(scope: EnvironmentScope, entry: WatchUpdateInput): Promise<void> {
    await this.addOrUpdate(scope, entry, (existing, incoming) => ({
      ...existing,
      jobName: incoming.jobName ?? existing.jobName,
      jobKind: incoming.jobKind ?? existing.jobKind
    }));
  }

  async removeWatch(
    scope: EnvironmentScope,
    environmentId: string,
    jobUrl: string
  ): Promise<boolean> {
    return this.remove(scope, environmentId, jobUrl);
  }

  async removeWatchesForEnvironment(scope: EnvironmentScope, environmentId: string): Promise<void> {
    await this.removeForEnvironment(scope, environmentId);
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
    const entries = await this.getEntries(scope);
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
      await this.saveEntries(scope, next);
    }
  }

  async updateWatchUrl(
    scope: EnvironmentScope,
    environmentId: string,
    oldJobUrl: string,
    newJobUrl: string,
    newJobName?: string
  ): Promise<boolean> {
    return this.updateUrl(scope, environmentId, oldJobUrl, newJobUrl, newJobName);
  }
}
