import type * as vscode from "vscode";
import type { EnvironmentScope } from "./JenkinsEnvironmentStore";

export interface ScopedJobStoreEntry {
  environmentId: string;
  jobUrl: string;
  jobName?: string;
  jobKind?: "job" | "pipeline";
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
      this.getStoredEntries("workspace"),
      this.getStoredEntries("global")
    ]);
    return [
      ...workspace.map((entry) => toScoped("workspace", entry)),
      ...global.map((entry) => toScoped("global", entry))
    ];
  }

  protected async getJobUrls(
    scope: EnvironmentScope,
    environmentId: string
  ): Promise<Set<string>> {
    const entries = await this.getStoredEntries(scope);
    return new Set(
      entries
        .filter((entry) => entry.environmentId === environmentId)
        .map((entry) => entry.jobUrl)
    );
  }

  protected async isTracked(
    scope: EnvironmentScope,
    environmentId: string,
    jobUrl: string
  ): Promise<boolean> {
    const entries = await this.getStoredEntries(scope);
    return entries.some((entry) => entry.environmentId === environmentId && entry.jobUrl === jobUrl);
  }

  protected async addOrUpdate(
    scope: EnvironmentScope,
    entry: TEntry,
    merge: (existing: TEntry, incoming: TEntry) => TEntry
  ): Promise<void> {
    const entries = await this.getStoredEntries(scope);
    const index = entries.findIndex((item) => this.isSameJob(item, entry));

    if (index >= 0) {
      const existing = entries[index];
      entries[index] = merge(existing, entry);
    } else {
      entries.push(entry);
    }

    await this.saveStoredEntries(scope, entries);
  }

  protected async getEntries(scope: EnvironmentScope): Promise<TEntry[]> {
    return this.getStoredEntries(scope);
  }

  protected async saveEntries(scope: EnvironmentScope, entries: TEntry[]): Promise<void> {
    await this.saveStoredEntries(scope, entries);
  }

  protected async remove(
    scope: EnvironmentScope,
    environmentId: string,
    jobUrl: string
  ): Promise<boolean> {
    const entries = await this.getStoredEntries(scope);
    const next = entries.filter((entry) => !this.isSameJob(entry, { environmentId, jobUrl }));
    if (next.length === entries.length) {
      return false;
    }
    await this.saveStoredEntries(scope, next);
    return true;
  }

  protected async removeForEnvironment(
    scope: EnvironmentScope,
    environmentId: string
  ): Promise<void> {
    const entries = await this.getStoredEntries(scope);
    const next = entries.filter((entry) => entry.environmentId !== environmentId);
    if (next.length === entries.length) {
      return;
    }
    await this.saveStoredEntries(scope, next);
  }

  protected async updateUrl(
    scope: EnvironmentScope,
    environmentId: string,
    oldJobUrl: string,
    newJobUrl: string,
    newJobName?: string
  ): Promise<boolean> {
    const entries = await this.getStoredEntries(scope);
    let found = false;
    const next: TEntry[] = [];

    for (const entry of entries) {
      if (entry.environmentId === environmentId && entry.jobUrl === oldJobUrl) {
        found = true;
        next.push({ ...entry, jobUrl: newJobUrl, jobName: newJobName ?? entry.jobName });
      } else {
        next.push(entry);
      }
    }

    if (!found) {
      return false;
    }

    await this.saveStoredEntries(scope, next);
    return true;
  }

  protected isSameJob(entry: TEntry, other: { environmentId: string; jobUrl: string }): boolean {
    return entry.environmentId === other.environmentId && entry.jobUrl === other.jobUrl;
  }

  protected getStoredEntries(scope: EnvironmentScope): Promise<TEntry[]> {
    const memento = this.getMemento(scope);
    const stored = memento.get<TEntry[]>(this.storageKey);
    return Promise.resolve(Array.isArray(stored) ? stored : []);
  }

  protected async saveStoredEntries(scope: EnvironmentScope, entries: TEntry[]): Promise<void> {
    const memento = this.getMemento(scope);
    await memento.update(this.storageKey, entries);
  }

  private getMemento(scope: EnvironmentScope): vscode.Memento {
    return scope === "workspace" ? this.context.workspaceState : this.context.globalState;
  }
}
