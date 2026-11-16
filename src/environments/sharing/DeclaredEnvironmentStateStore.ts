import type * as vscode from "vscode";
import { ensureTrailingSlash } from "../../jenkins/urls";
import type { EnvironmentScope } from "../../storage/JenkinsEnvironmentStore";
import { createSerialTaskQueue } from "../../storage/SerialTaskQueue";
import { getScopedMemento } from "../../storage/StorageScope";
import type { DeclaredEnvironment } from "./DeclaredEnvironmentSource";

/** Per-user, local state for a settings-declared environment. Never written to settings. */
export interface DeclaredEnvironmentLocalState {
  /** URL this state last saw; a different declared URL is recorded in `previousUrls`. */
  lastUrl?: string;
  /** Earlier declared base URLs, newest first, used to rebase stored job URLs. */
  previousUrls?: string[];
  /** Hidden by the user in this scope. */
  hidden?: boolean;
  /** Origin the user confirmed connecting to. */
  acknowledgedOrigin?: string;
  /** The user chose to keep a same-URL manual environment separate. */
  adoptDeclined?: boolean;
}

export interface DeclaredEnvironmentUrlChange {
  scope: EnvironmentScope;
  id: string;
  previousUrl: string;
  url: string;
}

export interface EnvironmentScopedId {
  scope: EnvironmentScope;
  id: string;
}

interface StoredState {
  entries: Record<string, DeclaredEnvironmentLocalState>;
  /** Stored (manual) environments hidden in this workspace only; kept in workspaceState. */
  hiddenStoredIds?: EnvironmentScopedId[];
}

export const DECLARED_ENVIRONMENT_STATE_KEY = "jenkinsWorkbench.declaredEnvironmentState";
const MAX_PREVIOUS_URLS = 5;
const SCOPES: readonly EnvironmentScope[] = ["workspace", "global"];

/**
 * Read access to declared local state, as exposed outside `DeclaredEnvironmentRegistry`, which
 * holds the only writable `DeclaredEnvironmentStateStore`.
 */
export interface DeclaredEnvironmentStateReader {
  get(scope: EnvironmentScope, id: string): DeclaredEnvironmentLocalState;
  /** Whether a stored (manual) environment is hidden in this workspace. */
  isStoredHidden(scope: EnvironmentScope, id: string): boolean;
}

export class DeclaredEnvironmentStateStore implements DeclaredEnvironmentStateReader {
  private readonly queue = createSerialTaskQueue();

  constructor(private readonly context: vscode.ExtensionContext) {}

  get(scope: EnvironmentScope, id: string): DeclaredEnvironmentLocalState {
    const entry = this.read(scope).entries[id];
    return entry
      ? { ...entry, ...(entry.previousUrls ? { previousUrls: [...entry.previousUrls] } : {}) }
      : {};
  }

  update(
    scope: EnvironmentScope,
    id: string,
    patch: Partial<DeclaredEnvironmentLocalState>
  ): Promise<void> {
    return this.queue(() =>
      this.mutate(scope, (state) => {
        const next: DeclaredEnvironmentLocalState = { ...state.entries[id] };
        for (const [key, value] of Object.entries(patch) as Array<
          [keyof DeclaredEnvironmentLocalState, unknown]
        >) {
          if (value === undefined) {
            delete next[key];
          } else {
            (next as Record<string, unknown>)[key] = value;
          }
        }
        setEntry(state, id, next);
        return true;
      })
    );
  }

  /** Reconciles lastUrl/previousUrls with the current declarations; returns ids whose URL changed. */
  reconcileUrls(declared: readonly DeclaredEnvironment[]): Promise<DeclaredEnvironmentUrlChange[]> {
    return this.queue(async () => {
      const changes: DeclaredEnvironmentUrlChange[] = [];
      for (const scope of SCOPES) {
        const inScope = declared.filter((entry) => entry.scope === scope);
        if (inScope.length === 0) {
          continue;
        }
        await this.mutate(scope, (state) => {
          let changed = false;
          for (const environment of inScope) {
            const url = ensureTrailingSlash(environment.url);
            const entry = state.entries[environment.id] ?? {};
            if (entry.lastUrl !== undefined && ensureTrailingSlash(entry.lastUrl) === url) {
              continue;
            }
            changed = true;
            if (entry.lastUrl === undefined) {
              setEntry(state, environment.id, { ...entry, lastUrl: url });
              continue;
            }
            const previousUrl = ensureTrailingSlash(entry.lastUrl);
            const previousUrls = [previousUrl, ...(entry.previousUrls ?? [])]
              .map(ensureTrailingSlash)
              .filter(
                (candidate, index, all) => candidate !== url && all.indexOf(candidate) === index
              )
              .slice(0, MAX_PREVIOUS_URLS);
            setEntry(state, environment.id, { ...entry, lastUrl: url, previousUrls });
            changes.push({ scope, id: environment.id, previousUrl, url });
          }
          return changed;
        });
      }
      return changes;
    });
  }

  isStoredHidden(scope: EnvironmentScope, id: string): boolean {
    return (this.read("workspace").hiddenStoredIds ?? []).some(
      (entry) => entry.scope === scope && entry.id === id
    );
  }

  /** Hides a stored environment in this workspace only. */
  hideStored(scope: EnvironmentScope, id: string): Promise<void> {
    return this.queue(() =>
      this.mutate("workspace", (state) => {
        const hidden = state.hiddenStoredIds ?? [];
        if (hidden.some((entry) => entry.scope === scope && entry.id === id)) {
          return false;
        }
        state.hiddenStoredIds = [...hidden, { scope, id }];
        return true;
      })
    );
  }

  /** Shows a stored environment hidden by `hideStored` again. */
  // fallow-ignore-next-line unused-class-member -- called by the declared environment registry
  unhideStored(scope: EnvironmentScope, id: string): Promise<void> {
    return this.queue(() =>
      this.mutate("workspace", (state) => {
        const hidden = state.hiddenStoredIds ?? [];
        const next = hidden.filter((entry) => entry.scope !== scope || entry.id !== id);
        if (next.length === hidden.length) {
          return false;
        }
        if (next.length > 0) {
          state.hiddenStoredIds = next;
        } else {
          delete state.hiddenStoredIds;
        }
        return true;
      })
    );
  }

  /** Stored environments hidden in this workspace. */
  listHiddenStored(): EnvironmentScopedId[] {
    return (this.read("workspace").hiddenStoredIds ?? []).map(({ scope, id }) => ({ scope, id }));
  }

  setHidden(scope: EnvironmentScope, id: string, hidden: boolean): Promise<void> {
    return this.update(scope, id, { hidden: hidden ? true : undefined });
  }

  // fallow-ignore-next-line unused-class-member -- called by the declared environment registry
  listHidden(): EnvironmentScopedId[] {
    return SCOPES.flatMap((scope) =>
      Object.entries(this.read(scope).entries)
        .filter(([, entry]) => entry.hidden === true)
        .map(([id]) => ({ scope, id }))
    );
  }

  acknowledgeOrigin(scope: EnvironmentScope, id: string, origin: string): Promise<void> {
    return this.update(scope, id, { acknowledgedOrigin: origin });
  }

  private read(scope: EnvironmentScope): StoredState {
    const stored = getScopedMemento(this.context, scope).get<unknown>(
      DECLARED_ENVIRONMENT_STATE_KEY
    );
    if (!stored || typeof stored !== "object") {
      return { entries: {} };
    }
    const { entries, hiddenStoredIds } = stored as Partial<StoredState>;
    return {
      entries: entries && typeof entries === "object" ? entries : {},
      ...(Array.isArray(hiddenStoredIds) ? { hiddenStoredIds } : {})
    };
  }

  /** Read-modify-write of one scope; `apply` returns whether anything changed. Call inside the queue. */
  private async mutate(
    scope: EnvironmentScope,
    apply: (state: StoredState) => boolean
  ): Promise<void> {
    const current = this.read(scope);
    const state: StoredState = {
      entries: { ...current.entries },
      ...(current.hiddenStoredIds ? { hiddenStoredIds: [...current.hiddenStoredIds] } : {})
    };
    if (!apply(state)) {
      return;
    }
    await getScopedMemento(this.context, scope).update(DECLARED_ENVIRONMENT_STATE_KEY, state);
  }
}

function setEntry(state: StoredState, id: string, entry: DeclaredEnvironmentLocalState): void {
  if (Object.keys(entry).length === 0) {
    delete state.entries[id];
  } else {
    state.entries[id] = entry;
  }
}
