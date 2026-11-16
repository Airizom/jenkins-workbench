import * as vscode from "vscode";
import type { FullEnvironmentRefreshHost } from "../../extension/ExtensionRefreshHost";
import type { JenkinsClientProvider } from "../../jenkins/JenkinsClientProvider";
import {
  ENVIRONMENTS_KEY,
  type JenkinsEnvironment,
  type JenkinsEnvironmentStore
} from "../../storage/JenkinsEnvironmentStore";
import { PINNED_JOBS_KEY } from "../../storage/JenkinsPinStore";
import { WATCHED_JOBS_KEY } from "../../storage/JenkinsWatchStore";

/**
 * globalState keys shared through Settings Sync: user-scope environment records (never secrets),
 * pins and watches. URL-rebase bookkeeping lives in workspaceState, which cannot sync.
 * Changing the stored shape of any of these reaches machines still running older versions.
 */
export const SYNCED_GLOBAL_STATE_KEYS: readonly string[] = [
  ENVIRONMENTS_KEY,
  PINNED_JOBS_KEY,
  WATCHED_JOBS_KEY
];

const SYNC_SETTING_SECTION = "jenkinsWorkbench";
const SYNC_SETTING_KEY = "syncEnvironments";
const DEFAULT_CHECK_DELAY_MS = 500;

export interface EnvironmentSyncDependencies {
  globalState: Pick<vscode.ExtensionContext["globalState"], "get" | "setKeysForSync">;
  environmentStore: Pick<JenkinsEnvironmentStore, "notifyExternalChange" | "onDidChange">;
  clientProvider: Pick<JenkinsClientProvider, "invalidateClient">;
  refreshHost: FullEnvironmentRefreshHost;
  syncNoEnvironmentsContext: () => Promise<unknown>;
  checkDelayMs?: number;
}

interface SyncedStateSnapshot {
  environments: Map<string, string>;
  jobs: string;
}

/**
 * Registers the synced globalState keys (`jenkinsWorkbench.syncEnvironments`) and notices when
 * they change underneath this window. Mementos fire no event for Settings Sync or other windows,
 * so the keys are compared on window focus; a change drops cached clients for the changed
 * environments, announces a bulk update and refreshes the tree. It never calls Jenkins itself.
 *
 * The only changes taken into the snapshot without a refresh are single global records this
 * window's environment store reports writing, and only that record. Generic refreshes, bulk
 * saves and pin or watch edits are not absorbed: a synced change can land unnoticed before any of
 * them, and absorbing it there would hide it for good. The cost is one extra tree refresh on the
 * next focus after such a local edit.
 */
export class EnvironmentSyncService implements vscode.Disposable {
  private readonly subscriptions: vscode.Disposable[] = [];
  private snapshot: SyncedStateSnapshot | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;

  constructor(private readonly dependencies: EnvironmentSyncDependencies) {}

  start(): void {
    if (this.subscriptions.length > 0 || this.disposed) {
      return;
    }
    this.applySyncedKeys();
    this.snapshot = this.readSnapshot();
    this.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration(`${SYNC_SETTING_SECTION}.${SYNC_SETTING_KEY}`)) {
          this.applySyncedKeys();
        }
      }),
      vscode.window.onDidChangeWindowState((state) => {
        if (state.focused) {
          this.scheduleCheck();
        }
      }),
      this.dependencies.environmentStore.onDidChange((change) => {
        if ("environmentId" in change && change.scope === "global") {
          this.absorbOwnRecordChange(change.environmentId);
        }
      })
    );
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    for (const subscription of this.subscriptions.splice(0)) {
      subscription.dispose();
    }
  }

  private applySyncedKeys(): void {
    const enabled =
      vscode.workspace
        .getConfiguration(SYNC_SETTING_SECTION)
        .get<boolean>(SYNC_SETTING_KEY, true) !== false;
    try {
      this.dependencies.globalState.setKeysForSync(enabled ? SYNCED_GLOBAL_STATE_KEYS : []);
    } catch (error) {
      console.warn("Failed to update the Jenkins environments synced with Settings Sync.", error);
    }
  }

  /** Focus bursts collapse into one check. */
  private scheduleCheck(): void {
    if (this.disposed) {
      return;
    }
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      try {
        this.check();
      } catch (error) {
        console.warn("Failed to apply synced Jenkins environment changes.", error);
      }
    }, this.dependencies.checkDelayMs ?? DEFAULT_CHECK_DELAY_MS);
  }

  /**
   * Takes one record this window just wrote into the snapshot, so its own edit does not refresh
   * again on the next focus. Every other environment and the pin/watch fingerprint keep their old
   * values, so a synced change already sitting in globalState is still found by the focus check.
   * The client is dropped anyway; that is cheap and covers a write that raced a synced one.
   */
  private absorbOwnRecordChange(environmentId: string): void {
    const snapshot = this.snapshot;
    if (this.disposed || !snapshot) {
      return;
    }
    try {
      const current = this.readSnapshot().environments.get(environmentId);
      if (snapshot.environments.get(environmentId) === current) {
        return;
      }
      if (current === undefined) {
        snapshot.environments.delete(environmentId);
      } else {
        snapshot.environments.set(environmentId, current);
      }
      this.dependencies.clientProvider.invalidateClient("global", environmentId);
    } catch (error) {
      console.warn("Failed to record a Jenkins environment change made in this window.", error);
    }
  }

  /** Drops cached clients for changed environments (sign-in is only checked when a client is built). */
  private check(): void {
    const previous = this.snapshot;
    const next = this.readSnapshot();
    this.snapshot = next;
    if (!previous) {
      return;
    }
    const changedIds = new Set<string>();
    for (const id of new Set([...previous.environments.keys(), ...next.environments.keys()])) {
      if (previous.environments.get(id) !== next.environments.get(id)) {
        changedIds.add(id);
      }
    }
    if (changedIds.size === 0 && previous.jobs === next.jobs) {
      return;
    }
    const { clientProvider, environmentStore, refreshHost } = this.dependencies;
    for (const id of changedIds) {
      clientProvider.invalidateClient("global", id);
    }
    if (changedIds.size > 0) {
      environmentStore.notifyExternalChange("global");
    }
    // Watches are read from the store on every poll, so the status poller needs no nudge.
    const { executed } = refreshHost.fullEnvironmentRefresh({ trigger: "system" });
    if (!executed) {
      void this.dependencies.syncNoEnvironmentsContext().catch((error) => {
        console.warn("Failed to sync Jenkins no-environments context after a sync.", error);
      });
    }
  }

  private readSnapshot(): SyncedStateSnapshot {
    const { globalState } = this.dependencies;
    const environments = new Map<string, string>();
    const stored = globalState.get<unknown>(ENVIRONMENTS_KEY);
    if (Array.isArray(stored)) {
      for (const environment of stored as JenkinsEnvironment[]) {
        if (typeof environment?.id === "string") {
          environments.set(environment.id, JSON.stringify(environment));
        }
      }
    }
    // Watch status fields change on every poll in each window; only membership matters here.
    const jobs = [PINNED_JOBS_KEY, WATCHED_JOBS_KEY]
      .map((key) => `${key}=${toJobIdentities(globalState.get<unknown>(key))}`)
      .join("\n");
    return { environments, jobs: hashString(jobs) };
  }
}

function toJobIdentities(value: unknown): string {
  if (!Array.isArray(value)) {
    return "";
  }
  return value
    .map((entry: { environmentId?: unknown; jobUrl?: unknown } | null) =>
      JSON.stringify([entry?.environmentId, entry?.jobUrl])
    )
    .sort()
    .join(",");
}

/** FNV-1a; a fingerprint for change detection, not a security boundary. */
function hashString(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${value.length}:${(hash >>> 0).toString(16)}`;
}
