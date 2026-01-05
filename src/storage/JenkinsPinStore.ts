import type * as vscode from "vscode";
import type { EnvironmentScope } from "./JenkinsEnvironmentStore";

export interface StoredPinnedJobEntry {
  environmentId: string;
  jobUrl: string;
  jobName?: string;
  jobKind?: "job" | "pipeline";
}

export interface PinnedJobEntry extends StoredPinnedJobEntry {
  scope: EnvironmentScope;
}

const PINNED_JOBS_KEY = "jenkinsWorkbench.pinnedJobs";

export class JenkinsPinStore {
  constructor(private readonly context: vscode.ExtensionContext) {}

  async listPinnedJobs(): Promise<PinnedJobEntry[]> {
    const [workspace, global] = await Promise.all([
      this.getPins("workspace"),
      this.getPins("global")
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

  async getPinnedJobUrls(scope: EnvironmentScope, environmentId: string): Promise<Set<string>> {
    const entries = await this.getPins(scope);
    return new Set(
      entries.filter((entry) => entry.environmentId === environmentId).map((entry) => entry.jobUrl)
    );
  }

  async isPinned(scope: EnvironmentScope, environmentId: string, jobUrl: string): Promise<boolean> {
    const entries = await this.getPins(scope);
    return entries.some(
      (entry) => entry.environmentId === environmentId && entry.jobUrl === jobUrl
    );
  }

  async addPin(scope: EnvironmentScope, entry: StoredPinnedJobEntry): Promise<void> {
    const entries = await this.getPins(scope);
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

    await this.savePins(scope, entries);
  }

  async removePin(
    scope: EnvironmentScope,
    environmentId: string,
    jobUrl: string
  ): Promise<boolean> {
    const entries = await this.getPins(scope);
    const next = entries.filter(
      (entry) => entry.environmentId !== environmentId || entry.jobUrl !== jobUrl
    );
    if (next.length === entries.length) {
      return false;
    }
    await this.savePins(scope, next);
    return true;
  }

  async removePinsForEnvironment(scope: EnvironmentScope, environmentId: string): Promise<void> {
    const entries = await this.getPins(scope);
    const next = entries.filter((entry) => entry.environmentId !== environmentId);
    if (next.length !== entries.length) {
      await this.savePins(scope, next);
    }
  }

  private getPins(scope: EnvironmentScope): Promise<StoredPinnedJobEntry[]> {
    const memento = this.getMemento(scope);
    const stored = memento.get<StoredPinnedJobEntry[]>(PINNED_JOBS_KEY);
    return Promise.resolve(Array.isArray(stored) ? stored : []);
  }

  private async savePins(scope: EnvironmentScope, entries: StoredPinnedJobEntry[]): Promise<void> {
    const memento = this.getMemento(scope);
    await memento.update(PINNED_JOBS_KEY, entries);
  }

  private getMemento(scope: EnvironmentScope): vscode.Memento {
    return scope === "workspace" ? this.context.workspaceState : this.context.globalState;
  }
}
