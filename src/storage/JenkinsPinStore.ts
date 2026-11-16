import type * as vscode from "vscode";
import type { EnvironmentRecordsCopy, EnvironmentRecordsRef } from "./EnvironmentRecordCopy";
import type { EnvironmentRecordStore } from "./EnvironmentRecordParticipant";
import type { EnvironmentScope } from "./JenkinsEnvironmentStore";
import {
  JenkinsScopedJobStore,
  mergeScopedJobEntryMetadata,
  type ScopedJobStoreEntry
} from "./ScopedJobStore";

export interface PinnedJobEntry extends ScopedJobStoreEntry {
  scope: EnvironmentScope;
}

export const PINNED_JOBS_KEY = "jenkinsWorkbench.pinnedJobs";

export class JenkinsPinStore
  extends JenkinsScopedJobStore<ScopedJobStoreEntry>
  implements EnvironmentRecordStore
{
  constructor(context: vscode.ExtensionContext) {
    super(context, PINNED_JOBS_KEY);
  }

  async listPinnedJobs(): Promise<PinnedJobEntry[]> {
    return this.listWithScope((scope, entry) => ({ ...entry, scope }));
  }

  async listPinnedJobsForEnvironment(
    scope: EnvironmentScope,
    environmentId: string
  ): Promise<ScopedJobStoreEntry[]> {
    const entries = await this.listPinnedJobs();
    return entries.filter(
      (entry) => entry.scope === scope && entry.environmentId === environmentId
    );
  }

  async isPinned(scope: EnvironmentScope, environmentId: string, jobUrl: string): Promise<boolean> {
    return this.isTracked(scope, environmentId, jobUrl);
  }

  async addPin(scope: EnvironmentScope, entry: ScopedJobStoreEntry): Promise<void> {
    await this.addOrUpdate(scope, entry, mergeScopedJobEntryMetadata);
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

    return this.removeJobs(scope, environmentId, new Set(missing.map((entry) => entry.jobUrl)));
  }

  async updatePinUrl(
    scope: EnvironmentScope,
    environmentId: string,
    oldJobUrl: string,
    newJobUrl: string,
    newJobName?: string
  ): Promise<boolean> {
    return this.updateUrl(
      scope,
      environmentId,
      oldJobUrl,
      newJobUrl,
      newJobName,
      mergeScopedJobEntryMetadata
    );
  }

  /** Copies an environment's pinned jobs to another environment id or scope; see EnvironmentRecordsCopy. */
  copyEnvironmentRecords(
    from: EnvironmentRecordsRef,
    to: EnvironmentRecordsRef
  ): Promise<EnvironmentRecordsCopy> {
    return this.copyForEnvironment(from, to);
  }

  removeEnvironmentRecords(ref: EnvironmentRecordsRef): Promise<void> {
    return this.removePinsForEnvironment(ref.scope, ref.environmentId);
  }

  async rebasePinUrls(
    scope: EnvironmentScope,
    environmentId: string,
    oldBases: readonly string[],
    newBase: string
  ): Promise<number> {
    return this.rebaseForEnvironment(
      scope,
      environmentId,
      oldBases,
      newBase,
      mergeScopedJobEntryMetadata
    );
  }
}
