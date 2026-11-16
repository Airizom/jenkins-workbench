import * as vscode from "vscode";
import { rebaseEnvironmentUrl } from "../jenkins/urls";
import {
  type EnvironmentRecordsCopy,
  type EnvironmentRecordsRef,
  NO_RECORDS_COPIED
} from "./EnvironmentRecordCopy";
import type { EnvironmentRecordStore } from "./EnvironmentRecordParticipant";

export type JobFilterMode = "all" | "failing" | "running";

interface StoredViewState {
  jobFilterMode?: JobFilterMode;
  branchFilters?: Record<string, string>;
}

const VIEW_STATE_KEY = "jenkinsWorkbench.viewState";

export class JenkinsViewStateStore implements EnvironmentRecordStore {
  private readonly emitter = new vscode.EventEmitter<void>();

  readonly onDidChange = this.emitter.event;

  constructor(private readonly context: vscode.ExtensionContext) {}

  getJobFilterMode(): JobFilterMode {
    const state = this.getState();
    if (state.jobFilterMode === "failing" || state.jobFilterMode === "running") {
      return state.jobFilterMode;
    }
    return "all";
  }

  async setJobFilterMode(mode: JobFilterMode): Promise<void> {
    const state = this.getState();
    if (state.jobFilterMode === mode) {
      return;
    }
    await this.updateState({
      ...state,
      jobFilterMode: mode
    });
    await this.updateFilterContext(mode);
    this.emitter.fire();
  }

  // fallow-ignore-next-line unused-class-member
  async syncFilterContext(): Promise<void> {
    await this.updateFilterContext(this.getJobFilterMode());
  }

  private async updateFilterContext(mode: JobFilterMode): Promise<void> {
    await vscode.commands.executeCommand("setContext", "jenkinsWorkbench.filterMode", mode);
  }

  getBranchFilter(environmentId: string, folderUrl: string): string | undefined {
    const state = this.getState();
    const key = this.getBranchKey(environmentId, folderUrl);
    const value = state.branchFilters?.[key];
    return value && value.trim().length > 0 ? value : undefined;
  }

  async setBranchFilter(environmentId: string, folderUrl: string, filter: string): Promise<void> {
    const normalized = filter.trim();
    const state = this.getState();
    const key = this.getBranchKey(environmentId, folderUrl);
    const branchFilters = { ...(state.branchFilters ?? {}) };

    if (normalized.length === 0) {
      if (!(key in branchFilters)) {
        return;
      }
      delete branchFilters[key];
    } else if (branchFilters[key] === normalized) {
      return;
    } else {
      branchFilters[key] = normalized;
    }

    await this.updateState({ ...state, branchFilters });
    this.emitter.fire();
  }

  async clearBranchFilter(environmentId: string, folderUrl: string): Promise<void> {
    await this.setBranchFilter(environmentId, folderUrl, "");
  }

  /**
   * Moves an environment's branch filters from folder URLs under any of `oldBases` onto
   * `newBase` after its URL was edited. A filter already saved for the new URL is kept.
   */
  async rebaseBranchFilterUrls(
    environmentId: string,
    oldBases: readonly string[],
    newBase: string
  ): Promise<number> {
    const state = this.getState();
    const prefix = this.getBranchKey(environmentId, "");
    const branchFilters = { ...(state.branchFilters ?? {}) };
    let moved = 0;
    for (const [key, filter] of Object.entries(state.branchFilters ?? {})) {
      const folderUrl = key.startsWith(prefix)
        ? rebaseEnvironmentUrl(key.slice(prefix.length), oldBases, newBase)
        : undefined;
      if (!folderUrl) {
        continue;
      }
      delete branchFilters[key];
      const nextKey = this.getBranchKey(environmentId, folderUrl);
      branchFilters[nextKey] = state.branchFilters?.[nextKey] ?? filter;
      moved += 1;
    }
    if (moved === 0) {
      return 0;
    }

    await this.updateState({ ...state, branchFilters });
    this.emitter.fire();
    return moved;
  }

  /**
   * Copies an environment's branch filters to another environment id. Filters live in this
   * workspace and are keyed by id only, so the scopes do not matter; a filter the target already
   * has for a folder is kept. See EnvironmentRecordsCopy.
   */
  async copyEnvironmentRecords(
    from: EnvironmentRecordsRef,
    to: EnvironmentRecordsRef
  ): Promise<EnvironmentRecordsCopy> {
    if (from.environmentId === to.environmentId) {
      return NO_RECORDS_COPIED;
    }
    const state = this.getState();
    const prefix = this.getBranchKey(from.environmentId, "");
    const branchFilters = { ...(state.branchFilters ?? {}) };
    const added: Array<[string, string]> = [];
    for (const [key, filter] of Object.entries(state.branchFilters ?? {})) {
      const targetKey = key.startsWith(prefix)
        ? this.getBranchKey(to.environmentId, key.slice(prefix.length))
        : undefined;
      if (targetKey && !(targetKey in branchFilters)) {
        branchFilters[targetKey] = filter;
        added.push([targetKey, filter]);
      }
    }
    if (added.length === 0) {
      return NO_RECORDS_COPIED;
    }
    await this.updateState({ ...state, branchFilters });
    this.emitter.fire();
    return {
      copied: added.length,
      undo: async () => {
        const current = this.getState();
        const next = { ...(current.branchFilters ?? {}) };
        const removed = added.filter(([key, filter]) => next[key] === filter);
        if (removed.length === 0) {
          return;
        }
        for (const [key] of removed) {
          delete next[key];
        }
        await this.updateState({ ...current, branchFilters: next });
        this.emitter.fire();
      }
    };
  }

  /**
   * Removes an environment's branch filters. Like the copy, this matches the id only: filters
   * live in this workspace and are not keyed by scope.
   */
  async removeEnvironmentRecords(ref: EnvironmentRecordsRef): Promise<void> {
    const state = this.getState();
    const prefix = this.getBranchKey(ref.environmentId, "");
    const branchFilters = { ...(state.branchFilters ?? {}) };
    const keys = Object.keys(branchFilters).filter((key) => key.startsWith(prefix));
    if (keys.length === 0) {
      return;
    }
    for (const key of keys) {
      delete branchFilters[key];
    }
    await this.updateState({ ...state, branchFilters });
    this.emitter.fire();
  }

  private getState(): StoredViewState {
    const stored = this.context.workspaceState.get<StoredViewState>(VIEW_STATE_KEY);
    return stored ?? {};
  }

  private async updateState(state: StoredViewState): Promise<void> {
    await this.context.workspaceState.update(VIEW_STATE_KEY, state);
  }

  private getBranchKey(environmentId: string, folderUrl: string): string {
    return `${environmentId}:${folderUrl}`;
  }
}
