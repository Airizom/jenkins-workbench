import type { EnvironmentRecordsCopy, EnvironmentRecordsRef } from "./EnvironmentRecordCopy";

/**
 * One kind of per-environment record kept outside the environment store (pins, presets, branch
 * filters, ...). Linking a manual environment to a shared definition copies every participant's
 * records to the declared id and then removes them from the old one; removing or hiding an
 * environment removes them. The participant list is registered once (the
 * `environmentRecordParticipants` token, built by `createEnvironmentRecordParticipants`), so a new
 * environment-id-keyed store is added there instead of to each of those flows.
 */
export interface EnvironmentRecordParticipant {
  /** Names the records in error messages, for example "pinned jobs". */
  readonly label: string;
  /** See `EnvironmentRecordsCopy` for the contract. */
  copyEnvironmentRecords(
    from: EnvironmentRecordsRef,
    to: EnvironmentRecordsRef
  ): Promise<EnvironmentRecordsCopy>;
  /**
   * Removes the records of one environment that this window can reach: those in the memento of
   * `ref.scope` for scoped stores (global records are shared by every workspace), and this
   * workspace's for workspace-only stores. Records re-pointed at another environment by
   * `copyEnvironmentRecords` no longer match `ref` and are left alone.
   */
  removeEnvironmentRecords(ref: EnvironmentRecordsRef): Promise<void>;
}

/** A store that keeps per-environment records; `toEnvironmentRecordParticipant` labels it. */
export interface EnvironmentRecordStore {
  copyEnvironmentRecords(
    from: EnvironmentRecordsRef,
    to: EnvironmentRecordsRef
  ): Promise<EnvironmentRecordsCopy> | EnvironmentRecordsCopy;
  removeEnvironmentRecords(ref: EnvironmentRecordsRef): Promise<unknown>;
}

function toEnvironmentRecordParticipant(
  label: string,
  store: EnvironmentRecordStore
): EnvironmentRecordParticipant {
  return {
    label,
    // Async wrappers so a store that throws synchronously is reported like a rejected one.
    copyEnvironmentRecords: async (from, to) => store.copyEnvironmentRecords(from, to),
    removeEnvironmentRecords: async (ref) => {
      await store.removeEnvironmentRecords(ref);
    }
  };
}

/** Every store keyed by environment id; see `createEnvironmentRecordParticipants`. */
export interface EnvironmentRecordStores {
  pinStore: EnvironmentRecordStore;
  watchStore: EnvironmentRecordStore;
  /** The status poller's in-memory watch state. */
  watchRuntimeState: EnvironmentRecordStore;
  /** Parameter presets and their secrets. */
  presetStore: EnvironmentRecordStore;
  diagnosticBindingStore: EnvironmentRecordStore;
  repositoryLinkStore: EnvironmentRecordStore;
  historyBaselineStore: EnvironmentRecordStore;
  commitWatchStore: EnvironmentRecordStore;
  /** Branch filters. */
  viewStateStore: EnvironmentRecordStore;
  /** Per-folder Jenkinsfile validation environment selections. */
  jenkinsfileSelections: EnvironmentRecordStore;
  /** This workspace's URL rebase bookkeeping. */
  urlRebaseService: EnvironmentRecordStore;
}

/**
 * The single list of per-environment record kinds. Credentials are not part of it: they live in
 * the environment store, which copies and deletes them separately.
 */
export function createEnvironmentRecordParticipants(
  stores: EnvironmentRecordStores
): EnvironmentRecordParticipant[] {
  return [
    toEnvironmentRecordParticipant("pinned jobs", stores.pinStore),
    toEnvironmentRecordParticipant("watched jobs", stores.watchStore),
    toEnvironmentRecordParticipant("watch status", stores.watchRuntimeState),
    toEnvironmentRecordParticipant("parameter presets", stores.presetStore),
    toEnvironmentRecordParticipant("diagnostic profile bindings", stores.diagnosticBindingStore),
    toEnvironmentRecordParticipant("repository links", stores.repositoryLinkStore),
    toEnvironmentRecordParticipant("history baselines", stores.historyBaselineStore),
    toEnvironmentRecordParticipant("commit watches", stores.commitWatchStore),
    toEnvironmentRecordParticipant("branch filters", stores.viewStateStore),
    toEnvironmentRecordParticipant(
      "Jenkinsfile environment selections",
      stores.jenkinsfileSelections
    ),
    toEnvironmentRecordParticipant("URL rebase records", stores.urlRebaseService)
  ];
}

/**
 * Removes one environment's records from every participant, in parallel. Never throws; returns
 * the failures, each prefixed with its participant's label.
 */
export async function removeAllEnvironmentRecords(
  participants: readonly EnvironmentRecordParticipant[],
  ref: EnvironmentRecordsRef
): Promise<Error[]> {
  const results = await Promise.allSettled(
    participants.map(async (participant) => participant.removeEnvironmentRecords(ref))
  );
  return results.flatMap((result, index) =>
    result.status === "rejected"
      ? [toLabelledRecordError(participants[index].label, result.reason)]
      : []
  );
}

export function toLabelledRecordError(label: string, reason: unknown): Error {
  const message = reason instanceof Error ? reason.message : String(reason);
  return new Error(`${label}: ${message}`, { cause: reason });
}
