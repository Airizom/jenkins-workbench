import type { EnvironmentScope } from "./JenkinsEnvironmentStore";

/** One environment's records: its scope picks the memento, its id keys the entries. */
export interface EnvironmentRecordsRef {
  scope: EnvironmentScope;
  environmentId: string;
}

/**
 * Result of `copyEnvironmentRecords(from, to)`. Every environment-keyed store implements that
 * method with the same contract:
 * - Records of `from` are written under `to` (its id, and its scope's memento for scoped stores),
 *   rewriting any embedded environment id or scope. The source records are left untouched.
 * - Single-valued records that can reference only one environment (repository links,
 *   Jenkinsfile environment selections, commit watches) are re-pointed at `to` instead.
 * - Records that already exist at the target are kept and not overwritten, so a repeated copy is
 *   a no-op.
 * - `undo()` reverses only what this call wrote: copied records are removed and re-pointed
 *   records restored, unless they were changed again since.
 */
export interface EnvironmentRecordsCopy {
  /** Number of records written or re-pointed. */
  copied: number;
  undo(): Promise<void>;
}

export const NO_RECORDS_COPIED: EnvironmentRecordsCopy = {
  copied: 0,
  undo: async () => undefined
};

export function isSameEnvironmentRecordsRef(
  left: EnvironmentRecordsRef,
  right: EnvironmentRecordsRef
): boolean {
  return left.scope === right.scope && left.environmentId === right.environmentId;
}
