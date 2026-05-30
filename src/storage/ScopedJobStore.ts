import type * as vscode from "vscode";
import type { EnvironmentScope } from "./JenkinsEnvironmentStore";

export interface ScopedJobStoreEntry {
  environmentId: string;
  jobUrl: string;
  jobName?: string;
  jobKind?: "job" | "pipeline";
}

export function mergeScopedJobEntryMetadata<TEntry extends ScopedJobStoreEntry>(
  existing: TEntry,
  incoming: TEntry
): TEntry {
  return {
    ...existing,
    jobName: incoming.jobName ?? existing.jobName,
    jobKind: incoming.jobKind ?? existing.jobKind
  };
}

export abstract class JenkinsScopedJobStore<TEntry extends ScopedJobStoreEntry> {
  protected constructor(
    protected readonly context: vscode.ExtensionContext,
    private readonly storageKey: string
  ) {}

  protected async listWithScope<TPublic extends TEntry & { scope: EnvironmentScope }>(
    toScoped: (scope: EnvironmentScope, entry: TEntry) => TPublic
  ): Promise<TPublic[]> {
    const [workspace, global] = await Promise.all([
      this.readEntries("workspace"),
      this.readEntries("global")
    ]);
    return [
      ...workspace.map((entry) => toScoped("workspace", entry)),
      ...global.map((entry) => toScoped("global", entry))
    ];
  }

  protected async getJobUrls(scope: EnvironmentScope, environmentId: string): Promise<Set<string>> {
    const entries = await this.readEntries(scope);
    return new Set(
      entries.filter((entry) => entry.environmentId === environmentId).map((entry) => entry.jobUrl)
    );
  }

  protected async isTracked(
    scope: EnvironmentScope,
    environmentId: string,
    jobUrl: string
  ): Promise<boolean> {
    const entries = await this.readEntries(scope);
    return entries.some(
      (entry) => entry.environmentId === environmentId && entry.jobUrl === jobUrl
    );
  }

  protected async addOrUpdate(
    scope: EnvironmentScope,
    entry: TEntry,
    merge: (existing: TEntry, incoming: TEntry) => TEntry
  ): Promise<void> {
    const entries = await this.readEntries(scope);
    const index = entries.findIndex((item) => this.isSameJob(item, entry));

    if (index >= 0) {
      const existing = entries[index];
      entries[index] = merge(existing, entry);
    } else {
      entries.push(entry);
    }

    await this.writeEntries(scope, entries);
  }

  protected async updateJob(
    scope: EnvironmentScope,
    environmentId: string,
    jobUrl: string,
    update: (entry: TEntry) => TEntry | undefined
  ): Promise<boolean> {
    const entries = await this.readEntries(scope);
    let changed = false;
    const next: TEntry[] = [];

    for (const entry of entries) {
      if (!this.isSameJob(entry, { environmentId, jobUrl })) {
        next.push(entry);
        continue;
      }

      const updated = update(entry);
      if (!updated) {
        next.push(entry);
        continue;
      }

      changed = true;
      next.push(updated);
    }

    if (!changed) {
      return false;
    }

    await this.writeEntries(scope, next);
    return true;
  }

  protected async remove(
    scope: EnvironmentScope,
    environmentId: string,
    jobUrl: string
  ): Promise<boolean> {
    const entries = await this.readEntries(scope);
    const next = entries.filter((entry) => !this.isSameJob(entry, { environmentId, jobUrl }));
    if (next.length === entries.length) {
      return false;
    }
    await this.writeEntries(scope, next);
    return true;
  }

  protected async removeJobs(
    scope: EnvironmentScope,
    environmentId: string,
    jobUrls: ReadonlySet<string>
  ): Promise<number> {
    if (jobUrls.size === 0) {
      return 0;
    }

    const entries = await this.readEntries(scope);
    const next = entries.filter(
      (entry) => entry.environmentId !== environmentId || !jobUrls.has(entry.jobUrl)
    );
    const removed = entries.length - next.length;
    if (removed === 0) {
      return 0;
    }

    await this.writeEntries(scope, next);
    return removed;
  }

  protected async removeForEnvironment(
    scope: EnvironmentScope,
    environmentId: string
  ): Promise<void> {
    const entries = await this.readEntries(scope);
    const next = entries.filter((entry) => entry.environmentId !== environmentId);
    if (next.length === entries.length) {
      return;
    }
    await this.writeEntries(scope, next);
  }

  protected async updateUrl(
    scope: EnvironmentScope,
    environmentId: string,
    oldJobUrl: string,
    newJobUrl: string,
    newJobName: string | undefined,
    merge: (existing: TEntry, incoming: TEntry) => TEntry
  ): Promise<boolean> {
    const entries = await this.readEntries(scope);
    const sourceEntries = entries.filter((entry) =>
      this.isSameJob(entry, { environmentId, jobUrl: oldJobUrl })
    );

    if (sourceEntries.length === 0) {
      return false;
    }

    const incomingEntries = sourceEntries.map((entry) => ({
      ...entry,
      jobUrl: newJobUrl,
      jobName: newJobName ?? entry.jobName
    }));
    const targetEntry =
      oldJobUrl === newJobUrl
        ? undefined
        : entries.find((entry) => this.isSameJob(entry, { environmentId, jobUrl: newJobUrl }));
    const mergedEntry = incomingEntries.reduce(
      (merged, incoming) => merge(merged, incoming),
      targetEntry ?? incomingEntries[0]
    );
    const shouldWriteAtTarget = Boolean(targetEntry);
    let wroteMergedEntry = false;
    const next: TEntry[] = [];

    for (const entry of entries) {
      if (this.isSameJob(entry, { environmentId, jobUrl: oldJobUrl })) {
        if (!shouldWriteAtTarget && !wroteMergedEntry) {
          next.push(mergedEntry);
          wroteMergedEntry = true;
        }
        continue;
      }

      if (this.isSameJob(entry, { environmentId, jobUrl: newJobUrl })) {
        if (shouldWriteAtTarget && !wroteMergedEntry) {
          next.push(mergedEntry);
          wroteMergedEntry = true;
        }
        continue;
      }

      next.push(entry);
    }

    await this.writeEntries(scope, next);
    return true;
  }

  protected isSameJob(entry: TEntry, other: { environmentId: string; jobUrl: string }): boolean {
    return entry.environmentId === other.environmentId && entry.jobUrl === other.jobUrl;
  }

  private readEntries(scope: EnvironmentScope): Promise<TEntry[]> {
    const memento = this.getMemento(scope);
    const stored = memento.get<TEntry[]>(this.storageKey);
    return Promise.resolve(Array.isArray(stored) ? stored : []);
  }

  private async writeEntries(scope: EnvironmentScope, entries: TEntry[]): Promise<void> {
    const memento = this.getMemento(scope);
    await memento.update(this.storageKey, entries);
  }

  private getMemento(scope: EnvironmentScope): vscode.Memento {
    return scope === "workspace" ? this.context.workspaceState : this.context.globalState;
  }
}
