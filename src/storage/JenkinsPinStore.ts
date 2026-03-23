import type * as vscode from "vscode";
import type { EnvironmentScope } from "./JenkinsEnvironmentStore";
import { JenkinsScopedJobStore, type ScopedJobStoreEntry } from "./ScopedJobStore";

export interface StoredPinnedJobEntry extends ScopedJobStoreEntry {}

export interface PinnedJobEntry extends StoredPinnedJobEntry {
  scope: EnvironmentScope;
}

const PINNED_JOBS_KEY = "jenkinsWorkbench.pinnedJobs";

export class JenkinsPinStore extends JenkinsScopedJobStore<StoredPinnedJobEntry> {
  constructor(context: vscode.ExtensionContext) {
    super(context, PINNED_JOBS_KEY);
  }

  async listPinnedJobs(): Promise<PinnedJobEntry[]> {
    return this.listWithScope((scope, entry) => ({ ...entry, scope }));
  }

  async listPinnedJobsForEnvironment(
    scope: EnvironmentScope,
    environmentId: string
  ): Promise<StoredPinnedJobEntry[]> {
    const entries = await this.listPinnedJobs();
    return entries.filter(
      (entry) => entry.scope === scope && entry.environmentId === environmentId
    );
  }

  async getPinnedJobUrls(scope: EnvironmentScope, environmentId: string): Promise<Set<string>> {
    return this.getJobUrls(scope, environmentId);
  }

  async isPinned(scope: EnvironmentScope, environmentId: string, jobUrl: string): Promise<boolean> {
    return this.isTracked(scope, environmentId, jobUrl);
  }

  async addPin(scope: EnvironmentScope, entry: StoredPinnedJobEntry): Promise<void> {
    await this.addOrUpdate(scope, entry, (existing, incoming) => ({
      ...existing,
      jobName: incoming.jobName ?? existing.jobName,
      jobKind: incoming.jobKind ?? existing.jobKind
    }));
  }

  async removePin(
    scope: EnvironmentScope,
    environmentId: string,
    jobUrl: string
  ): Promise<boolean> {
    return this.remove(scope, environmentId, jobUrl);
  }

  async removePinsForEnvironment(scope: EnvironmentScope, environmentId: string): Promise<void> {
    await this.removeForEnvironment(scope, environmentId);
  }

  async removeMissingPins(
    scope: EnvironmentScope,
    environmentId: string,
    validUrls: Set<string>
  ): Promise<number> {
    const entries = await this.listPinnedJobsForEnvironment(scope, environmentId);
    const missing = entries.filter((entry) => !validUrls.has(entry.jobUrl));

    if (missing.length === 0) {
      return 0;
    }

    await Promise.all(missing.map((entry) => this.remove(scope, environmentId, entry.jobUrl)));
    return missing.length;
  }

  async updatePinUrl(
    scope: EnvironmentScope,
    environmentId: string,
    oldJobUrl: string,
    newJobUrl: string,
    newJobName?: string
  ): Promise<boolean> {
    return this.updateUrl(scope, environmentId, oldJobUrl, newJobUrl, newJobName);
  }
}
