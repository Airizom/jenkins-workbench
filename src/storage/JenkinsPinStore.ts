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
