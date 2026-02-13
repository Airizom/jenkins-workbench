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
    await this.updateJob(scope, environmentId, jobUrl, (entry) => {
      const shouldUpdateCompleted = typeof update.lastCompletedBuildNumber === "number";
      const shouldUpdateBuilding = typeof update.lastIsBuilding === "boolean";

      const nextStatus = update.lastStatus ?? entry.lastStatus;
      const nextCompleted = shouldUpdateCompleted
        ? update.lastCompletedBuildNumber
        : entry.lastCompletedBuildNumber;
      const nextBuilding = shouldUpdateBuilding ? update.lastIsBuilding : entry.lastIsBuilding;
      const nextJobName = update.jobName ?? entry.jobName;

      const changed =
        nextStatus !== entry.lastStatus ||
        nextCompleted !== entry.lastCompletedBuildNumber ||
        nextBuilding !== entry.lastIsBuilding ||
        nextJobName !== entry.jobName;

      if (!changed) {
        return undefined;
      }

      return {
        ...entry,
        lastStatus: nextStatus,
        lastCompletedBuildNumber: nextCompleted,
        lastIsBuilding: nextBuilding,
        jobName: nextJobName
      };
    });
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
