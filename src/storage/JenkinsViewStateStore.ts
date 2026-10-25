import * as vscode from "vscode";
import { rebaseEnvironmentUrl } from "../jenkins/urls";

export type JobFilterMode = "all" | "failing" | "running";

interface StoredViewState {
  jobFilterMode?: JobFilterMode;
  branchFilters?: Record<string, string>;
}

const VIEW_STATE_KEY = "jenkinsWorkbench.viewState";

export class JenkinsViewStateStore {
  private readonly emitter = new vscode.EventEmitter<void>();

  // fallow-ignore-next-line unused-class-member
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
