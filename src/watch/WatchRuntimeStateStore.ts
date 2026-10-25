import type { EnvironmentScope } from "../storage/JenkinsEnvironmentStore";
import type { WatchedJobEntry } from "../storage/JenkinsWatchStore";

interface WatchRuntimeState {
  failureCount: number;
  pendingInput: { buildUrl: string; signature: string } | undefined;
}

/** Transient state for currently watched jobs, separate from persisted watch status. */
export class WatchRuntimeStateStore {
  private readonly states = new Map<string, WatchRuntimeState>();

  get(entry: WatchedJobEntry): WatchRuntimeState | undefined {
    return this.states.get(this.keyFor(entry));
  }

  getOrCreate(entry: WatchedJobEntry): WatchRuntimeState {
    const key = this.keyFor(entry);
    const existing = this.states.get(key);
    if (existing) {
      return existing;
    }
    const state: WatchRuntimeState = { failureCount: 0, pendingInput: undefined };
    this.states.set(key, state);
    return state;
  }

  resetFailureCounts(): void {
    for (const state of this.states.values()) {
      state.failureCount = 0;
    }
  }

  /** Returns whether recovery changed the derived error count. */
  resetFailureCount(entry: WatchedJobEntry, maxConsecutiveErrors: number): boolean {
    const state = this.get(entry);
    if (!state || state.failureCount === 0) {
      return false;
    }
    const wasErrored = state.failureCount >= maxConsecutiveErrors;
    state.failureCount = 0;
    return wasErrored;
  }

  countErrors(maxConsecutiveErrors: number): number {
    let count = 0;
    for (const state of this.states.values()) {
      if (state.failureCount >= maxConsecutiveErrors) {
        count += 1;
      }
    }
    return count;
  }

  clearPendingInput(entry: WatchedJobEntry): void {
    const state = this.get(entry);
    if (state) {
      state.pendingInput = undefined;
    }
  }

  pruneInactive(entries: readonly WatchedJobEntry[]): void {
    const activeKeys = new Set(entries.map((entry) => this.keyFor(entry)));
    for (const key of this.states.keys()) {
      if (!activeKeys.has(key)) {
        this.states.delete(key);
      }
    }
  }

  clearEnvironment(scope: EnvironmentScope, environmentId: string): void {
    const prefix = `${scope}:${environmentId}:`;
    for (const key of this.states.keys()) {
      if (key.startsWith(prefix)) {
        this.states.delete(key);
      }
    }
  }

  remove(entry: WatchedJobEntry): void {
    this.states.delete(this.keyFor(entry));
  }

  /** Returns whether any runtime state was cleared. */
  clear(): boolean {
    if (this.states.size === 0) {
      return false;
    }
    this.states.clear();
    return true;
  }

  private keyFor(entry: WatchedJobEntry): string {
    return `${entry.scope}:${entry.environmentId}:${entry.jobUrl}`;
  }
}
