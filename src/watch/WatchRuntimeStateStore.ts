import {
  type EnvironmentRecordsCopy,
  type EnvironmentRecordsRef,
  isSameEnvironmentRecordsRef,
  NO_RECORDS_COPIED
} from "../storage/EnvironmentRecordCopy";
import type { EnvironmentRecordStore } from "../storage/EnvironmentRecordParticipant";
import type { EnvironmentScope } from "../storage/JenkinsEnvironmentStore";
import type { WatchedJobEntry } from "../storage/JenkinsWatchStore";

interface WatchRuntimeState {
  failureCount: number;
  pendingInput: { buildUrl: string; signature: string } | undefined;
}

/** Transient state for currently watched jobs, separate from persisted watch status. */
export class WatchRuntimeStateStore implements EnvironmentRecordStore {
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
    const prefix = this.prefixFor(scope, environmentId);
    for (const key of this.states.keys()) {
      if (key.startsWith(prefix)) {
        this.states.delete(key);
      }
    }
  }

  /**
   * Copies an environment's failure counts and pending-input signatures to another environment
   * id or scope, so linking it to a shared definition neither resets error badges nor repeats
   * input notifications. See EnvironmentRecordsCopy.
   */
  copyEnvironmentRecords(
    from: EnvironmentRecordsRef,
    to: EnvironmentRecordsRef
  ): EnvironmentRecordsCopy {
    if (isSameEnvironmentRecordsRef(from, to)) {
      return NO_RECORDS_COPIED;
    }
    const sourcePrefix = this.prefixFor(from.scope, from.environmentId);
    const targetPrefix = this.prefixFor(to.scope, to.environmentId);
    const added = new Map<string, WatchRuntimeState>();
    for (const [key, state] of this.states) {
      const targetKey = key.startsWith(sourcePrefix)
        ? targetPrefix + key.slice(sourcePrefix.length)
        : undefined;
      if (targetKey && !this.states.has(targetKey) && !added.has(targetKey)) {
        added.set(targetKey, {
          failureCount: state.failureCount,
          pendingInput: state.pendingInput ? { ...state.pendingInput } : undefined
        });
      }
    }
    if (added.size === 0) {
      return NO_RECORDS_COPIED;
    }
    for (const [key, state] of added) {
      this.states.set(key, state);
    }
    return {
      copied: added.size,
      undo: async () => {
        for (const [key, state] of added) {
          if (this.states.get(key) === state) {
            this.states.delete(key);
          }
        }
      }
    };
  }

  /** Clears an environment's runtime state; see `clearEnvironment`. */
  async removeEnvironmentRecords(ref: EnvironmentRecordsRef): Promise<void> {
    this.clearEnvironment(ref.scope, ref.environmentId);
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
    return `${this.prefixFor(entry.scope, entry.environmentId)}${entry.jobUrl}`;
  }

  private prefixFor(scope: EnvironmentScope, environmentId: string): string {
    return `${scope}:${environmentId}:`;
  }
}
