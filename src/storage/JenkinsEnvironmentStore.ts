import * as crypto from "node:crypto";
import * as vscode from "vscode";
import { parseAuthConfig } from "../jenkins/auth";
import type { JenkinsAuthConfig } from "../jenkins/types";
import {
  ensureTrailingSlash,
  getUrlOrigin,
  normalizeJenkinsUrlForComparison,
  stripUrlCredentials
} from "../jenkins/urls";
import {
  type DeclaredEnvironmentRecord,
  type DeclaredEnvironmentView,
  findSuppressingStored,
  isDeclaredEnvironmentId,
  isOriginAcknowledged
} from "./DeclaredEnvironmentView";
import {
  areAuthHintsEqual,
  type EnvironmentAuthHint,
  toEnvironmentAuthHint
} from "./EnvironmentAuthHint";
import { createSerialTaskQueue, type SerialTaskQueue } from "./SerialTaskQueue";
import { getScopedMemento } from "./StorageScope";

export type EnvironmentScope = "workspace" | "global";

export interface JenkinsEnvironment {
  id: string;
  url: string;
  /** Optional display name shown instead of the host label. */
  name?: string;
  username?: string;
  /** Explicit opt-in to skipping HTTPS certificate and hostname verification. */
  allowInsecureTls?: boolean;
  /**
   * Base URLs this environment used before its URL was edited, newest first. Stores that only
   * live in one workspace are rebased lazily from these on activation.
   */
  previousUrls?: string[];
  /** Set only on records merged in from `jenkinsWorkbench.environments`; never persisted. */
  source?: "settings";
  /**
   * How the server expects to be signed in to. Persisted on stored records (the store keeps it in
   * step with the auth config; see `toEnvironmentAuthHint`); computed from the declaration on
   * settings-declared records.
   */
  authHint?: EnvironmentAuthHint;
}

export type EnvironmentSignInRequirement = "none" | "credentials" | "confirm-origin";

export interface JenkinsEnvironmentPatch {
  /** `null` or an empty string clears the name. */
  name?: string | null;
  url?: string;
  allowInsecureTls?: boolean;
  /** Pass `null` to clear a legacy username. */
  username?: null;
}

export interface JenkinsEnvironmentUpdate {
  previous: JenkinsEnvironment;
  next: JenkinsEnvironment;
}

export interface JenkinsEnvironmentUpdateOptions {
  /** Prevents a TLS prompt for an old origin from authorizing a newly edited server. */
  expectedTlsOrigin?: string;
  /**
   * Runs after the record is saved but before `environment-updated` fires, so listeners never
   * see the new URL while dependent stores still hold URLs under the old one.
   */
  beforeNotify?: (update: JenkinsEnvironmentUpdate) => Promise<void>;
}

export interface EnvironmentWithScope extends JenkinsEnvironment {
  scope: EnvironmentScope;
}

type JenkinsEnvironmentStoreScopedChangeKind =
  | "environment-added"
  | "environment-removed"
  | "auth-config-updated"
  | "auth-config-deleted";

export type JenkinsEnvironmentStoreChange =
  | {
      kind: JenkinsEnvironmentStoreScopedChangeKind;
      scope: EnvironmentScope;
      environmentId: string;
    }
  | {
      kind: "environment-updated";
      scope: EnvironmentScope;
      environmentId: string;
      urlChanged: boolean;
      tlsPolicyChanged?: boolean;
      /** The record as saved by this update. */
      environment: JenkinsEnvironment;
    }
  | {
      kind: "bulk-update";
      scope?: EnvironmentScope;
    };

export const ENVIRONMENTS_KEY = "jenkinsWorkbench.environments";
/**
 * workspaceState key holding a random id generated once per workspace. SecretStorage is shared
 * by every workspace, so secrets of workspace-scoped declared environments (whose ids repeat
 * across repositories) are keyed under it.
 */
const WORKSPACE_SECRET_NAMESPACE_KEY = "jenkinsWorkbench.workspaceSecretNamespace";
/** Set in a scope's memento once `backfillAuthHints` completed there. Never synced. */
const AUTH_HINT_BACKFILL_VERSION_KEY = "jenkinsWorkbench.authHintBackfillVersion";
const AUTH_HINT_BACKFILL_VERSION = 1;
const AUTH_CONFIG_KEY = "jenkinsWorkbench.envAuthConfig";
const TOKEN_KEY = "jenkinsWorkbench.envToken";
const MAX_PREVIOUS_URLS = 5;
const ENVIRONMENT_SCOPES: readonly EnvironmentScope[] = ["workspace", "global"];

interface CredentialPresenceEntry {
  revision: number;
  generation: number;
  epoch: number;
  result: Promise<boolean>;
}

export class JenkinsEnvironmentStore {
  private readonly authConfigRevisions = new Map<string, number>();
  /** Advanced after every write or delete of an environment's token or auth config secret. */
  private readonly credentialGenerations = new Map<string, number>();
  /** Advanced when secrets change outside this store (another window). */
  private credentialEpoch = 0;
  /** Memoized `hasStoredCredentials`, so tree loads do not read the keychain every time. */
  private readonly credentialPresence = new Map<string, CredentialPresenceEntry>();
  private workspaceSecretNamespace: Promise<string> | undefined;
  private readonly authMutationQueue = createSerialTaskQueue();
  private readonly recordMutationQueue = createSerialTaskQueue();
  /** Record mutations currently running; auth writes made from inside one must not await another. */
  private activeRecordMutations = 0;
  private readonly mutationQueue: SerialTaskQueue = (task) =>
    this.recordMutationQueue(async () => {
      this.activeRecordMutations += 1;
      try {
        return await task();
      } finally {
        this.activeRecordMutations -= 1;
      }
    });
  private readonly emitter = new vscode.EventEmitter<JenkinsEnvironmentStoreChange>();

  readonly onDidChange = this.emitter.event;

  /**
   * `declared` reads settings declarations and the user's local state for them; without it the
   * store lists stored environments only. Declared local state is written by
   * `DeclaredEnvironmentRegistry`, never here.
   */
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly declared?: DeclaredEnvironmentView
  ) {
    // Another window may sign in to or remove a shared (global) environment's credentials.
    const subscription = context.secrets?.onDidChange?.((event) => {
      if (event.key.startsWith(AUTH_CONFIG_KEY) || event.key.startsWith(TOKEN_KEY)) {
        this.credentialEpoch += 1;
        this.credentialPresence.clear();
      }
    });
    if (subscription) {
      context.subscriptions?.push(subscription);
    }
  }

  /**
   * Stored environments (minus those hidden in this workspace) followed by visible
   * settings-declared ones. Mutations must read `getStoredEnvironments` instead.
   */
  getEnvironments(scope: EnvironmentScope): Promise<JenkinsEnvironment[]> {
    const stored = this.readStored(scope);
    const { declared } = this;
    if (!declared) {
      return Promise.resolve(stored);
    }
    return Promise.resolve([
      ...stored.filter(
        (environment) =>
          !isDeclaredEnvironmentId(environment.id) &&
          !declared.isStoredHidden(scope, environment.id)
      ),
      ...this.getVisibleDeclaredEnvironments(scope)
    ]);
  }

  /** The environments persisted in this scope's memento, without settings declarations. */
  getStoredEnvironments(scope: EnvironmentScope): Promise<JenkinsEnvironment[]> {
    return Promise.resolve(this.readStored(scope));
  }

  isDeclared(id: string): boolean {
    return isDeclaredEnvironmentId(id);
  }

  private currentRecord(scope: EnvironmentScope, id: string) {
    return isDeclaredEnvironmentId(id)
      ? this.declared?.getDeclaration(scope, id)
      : this.readStored(scope).find((entry) => entry?.id === id);
  }

  isCurrentController(scope: EnvironmentScope, id: string, url: string): boolean {
    // Removing a shared environment hides it locally while its declaration stays in settings.
    if (isDeclaredEnvironmentId(id) && this.declared?.getLocalState(scope, id).hidden) {
      return false;
    }
    const current = this.currentRecord(scope, id);
    return (
      current !== undefined &&
      normalizeJenkinsUrlForComparison(current.url) === normalizeJenkinsUrlForComparison(url)
    );
  }

  /** Resolves TLS policy from current state rather than a potentially stale environment reference. */
  getAllowInsecureTls(scope: EnvironmentScope, id: string, url: string): boolean {
    const environment = this.currentRecord(scope, id);
    return (
      environment !== undefined &&
      hasInsecureTls(environment) &&
      getUrlOrigin(environment.url) === getUrlOrigin(url)
    );
  }

  /**
   * Whether the user must act before this extension talks to the environment's server:
   * confirm a settings-declared origin, or supply credentials the auth hint asks for.
   */
  async getSignInRequirement(
    scope: EnvironmentScope,
    id: string,
    options: { hasCredentials?: boolean } = {}
  ): Promise<EnvironmentSignInRequirement> {
    // Callers that already read the secrets pass what they found, saving a keychain round trip.
    const hasCredentials = async () =>
      options.hasCredentials ?? (await this.hasStoredCredentials(scope, id));
    if (isDeclaredEnvironmentId(id)) {
      const declaration = this.declared?.getDeclaration(scope, id);
      if (!declaration) {
        return "none";
      }
      // The acknowledgment covers the server origin and any separate SSO sign-in page, so a
      // repository changing either needs a new confirmation.
      if (!isOriginAcknowledged(declaration, this.declared?.getLocalState(scope, id) ?? {})) {
        return "confirm-origin";
      }
      if (declaration.authHint?.type === "none") {
        return "none";
      }
      return (await hasCredentials()) ? "none" : "credentials";
    }

    const environment = this.readStored(scope).find((entry) => entry?.id === id);
    if (!environment?.authHint || environment.authHint.type === "none") {
      return "none";
    }
    return (await hasCredentials()) ? "none" : "credentials";
  }

  /**
   * Fires a change on behalf of `DeclaredEnvironmentRegistry`, whose writes to declared local
   * state change what this store lists.
   */
  // fallow-ignore-next-line unused-class-member -- called through the declared environment registry dependency
  fireChange(change: JenkinsEnvironmentStoreChange): void {
    this.emitter.fire(change);
  }

  async saveEnvironments(
    scope: EnvironmentScope,
    environments: JenkinsEnvironment[],
    change: JenkinsEnvironmentStoreChange = { kind: "bulk-update", scope }
  ): Promise<void> {
    const memento = getScopedMemento(this.context, scope);
    // Settings declarations live in settings; persisting them would duplicate them.
    await memento.update(
      ENVIRONMENTS_KEY,
      environments.filter((environment) => !isDeclaredEnvironmentId(environment.id))
    );
    this.emitter.fire(change);
  }

  addEnvironment(
    scope: EnvironmentScope,
    environment: JenkinsEnvironment,
    token?: string
  ): Promise<void> {
    return this.mutationQueue(async () => {
      const environments = [...(await this.getStoredEnvironments(scope))];
      environments.push(environment);
      await this.saveEnvironments(
        scope,
        environments,
        createScopedChange("environment-added", scope, environment.id)
      );
      if (token && token.length > 0) {
        await this.setToken(scope, environment.id, token);
      }
    });
  }

  /**
   * Removes a stored environment and its secrets. Returns false for a settings-declared
   * environment, which is never stored: `DeclaredEnvironmentRegistry.hideDeclaredEnvironment`
   * hides it instead.
   */
  removeEnvironment(scope: EnvironmentScope, id: string): Promise<boolean> {
    if (isDeclaredEnvironmentId(id)) {
      return Promise.resolve(false);
    }
    return this.mutationQueue(async () => {
      const environments = await this.getStoredEnvironments(scope);
      const next = environments.filter((environment) => environment.id !== id);
      if (next.length === environments.length) {
        return false;
      }
      await this.saveEnvironments(
        scope,
        next,
        createScopedChange("environment-removed", scope, id)
      );
      await this.deleteToken(scope, id);
      await this.deleteAuthConfig(scope, id);
      return true;
    });
  }

  /**
   * Edits an environment in place, keeping its id (and with it every per-environment record).
   * A URL change records the old URL in `previousUrls` so stored job URLs can be rebased.
   */
  updateEnvironment(
    scope: EnvironmentScope,
    id: string,
    patch: JenkinsEnvironmentPatch,
    options: JenkinsEnvironmentUpdateOptions = {}
  ): Promise<JenkinsEnvironmentUpdate | undefined> {
    return this.mutationQueue(async () => {
      if (isDeclaredEnvironmentId(id)) {
        return this.resolveDeclaredUpdate(scope, id, patch, options);
      }
      const environments = [...(await this.getStoredEnvironments(scope))];
      const index = environments.findIndex((environment) => environment.id === id);
      if (index < 0) {
        return undefined;
      }
      const previous = environments[index];
      if (
        options.expectedTlsOrigin !== undefined &&
        getUrlOrigin(previous.url) !== options.expectedTlsOrigin
      ) {
        return undefined;
      }
      const next = applyEnvironmentPatch(previous, patch);
      const urlChanged = next.url !== previous.url;

      const tlsPolicyChanged = hasInsecureTls(previous) !== hasInsecureTls(next);
      environments[index] = next;
      await getScopedMemento(this.context, scope).update(ENVIRONMENTS_KEY, environments);
      const update = { previous, next };
      try {
        await options.beforeNotify?.(update);
      } finally {
        this.emitter.fire({
          kind: "environment-updated",
          scope,
          environmentId: id,
          urlChanged,
          ...(tlsPolicyChanged ? { tlsPolicyChanged: true } : {}),
          environment: next
        });
      }
      return update;
    });
  }

  async listEnvironmentsWithScope(): Promise<EnvironmentWithScope[]> {
    const [workspace, global] = await Promise.all([
      this.getEnvironments("workspace"),
      this.getEnvironments("global")
    ]);
    return [
      ...workspace.map((environment) => ({
        ...environment,
        scope: "workspace" as const
      })),
      ...global.map((environment) => ({
        ...environment,
        scope: "global" as const
      }))
    ];
  }

  async migrateLegacyAuthConfigs(): Promise<void> {
    await Promise.all([
      this.mutationQueue(() => this.migrateLegacyAuthConfigsForScope("workspace")),
      this.mutationQueue(() => this.migrateLegacyAuthConfigsForScope("global"))
    ]);
  }

  /**
   * Activation pass for stored records saved before auth hints existed: gives each one without a
   * hint the hint of its stored auth config. Reads one secret per such record; failures are
   * logged and retried on the next activation. Runs once per scope: a completed pass is marked in
   * that scope's memento, and the store keeps hints current from then on.
   */
  async backfillAuthHints(): Promise<void> {
    await Promise.all(
      ENVIRONMENT_SCOPES.map((scope) =>
        this.mutationQueue(() => this.backfillAuthHintsForScope(scope))
      )
    );
  }

  /**
   * Announces that stored records changed outside this window (Settings Sync), so listeners
   * reload them.
   */
  // fallow-ignore-next-line unused-class-member -- called through the settings sync dependency
  notifyExternalChange(scope?: EnvironmentScope): void {
    this.emitter.fire(scope ? { kind: "bulk-update", scope } : { kind: "bulk-update" });
  }

  async setToken(scope: EnvironmentScope, id: string, token: string): Promise<void> {
    try {
      const key = await this.getTokenKey(scope, id);
      await this.context.secrets.store(key, token);
    } finally {
      this.bumpCredentialGeneration(scope, id);
    }
  }

  async deleteToken(scope: EnvironmentScope, id: string): Promise<void> {
    try {
      const key = await this.getTokenKey(scope, id);
      await this.context.secrets.delete(key);
    } finally {
      this.bumpCredentialGeneration(scope, id);
    }
  }

  async getToken(scope: EnvironmentScope, id: string): Promise<string | undefined> {
    return this.context.secrets.get(await this.getTokenKey(scope, id));
  }

  async setAuthConfig(
    scope: EnvironmentScope,
    id: string,
    authConfig: JenkinsAuthConfig
  ): Promise<void> {
    await this.authMutationQueue(() => this.setAuthConfigUnlocked(scope, id, authConfig));
    await this.recordAuthHint(scope, id, authConfig);
  }

  /**
   * Stores the auth config only if no other auth mutation has happened since
   * `expectedRevision` was read. Returns whether the config was stored.
   */
  async setAuthConfigIfRevision(
    scope: EnvironmentScope,
    id: string,
    authConfig: JenkinsAuthConfig,
    expectedRevision: number
  ): Promise<boolean> {
    const saved = await this.authMutationQueue(async () => {
      if (this.getAuthConfigRevision(scope, id) !== expectedRevision) {
        return false;
      }
      await this.setAuthConfigUnlocked(scope, id, authConfig);
      return true;
    });
    if (saved) {
      await this.recordAuthHint(scope, id, authConfig);
    }
    return saved;
  }

  deleteAuthConfig(scope: EnvironmentScope, id: string): Promise<void> {
    return this.authMutationQueue(() => this.deleteAuthConfigUnlocked(scope, id));
  }

  private async setAuthConfigUnlocked(
    scope: EnvironmentScope,
    id: string,
    authConfig: JenkinsAuthConfig
  ): Promise<void> {
    this.bumpAuthConfigRevision(scope, id);
    try {
      const key = await this.getAuthConfigKey(scope, id);
      await this.context.secrets.store(key, JSON.stringify(authConfig));
    } finally {
      this.bumpCredentialGeneration(scope, id);
    }
    this.fireEnvironmentChange("auth-config-updated", scope, id);
  }

  private async deleteAuthConfigUnlocked(scope: EnvironmentScope, id: string): Promise<void> {
    this.bumpAuthConfigRevision(scope, id);
    try {
      const key = await this.getAuthConfigKey(scope, id);
      await this.context.secrets.delete(key);
    } finally {
      this.bumpCredentialGeneration(scope, id);
    }
    this.fireEnvironmentChange("auth-config-deleted", scope, id);
  }

  async getAuthConfig(scope: EnvironmentScope, id: string): Promise<JenkinsAuthConfig | undefined> {
    const revision = this.getAuthConfigRevision(scope, id);
    const stored = await this.context.secrets.get(await this.getAuthConfigKey(scope, id));
    if (!stored) {
      return undefined;
    }

    try {
      const parsed = JSON.parse(stored);
      const authConfig = parseAuthConfig(parsed);
      if (!authConfig) {
        console.warn(`Invalid auth config for environment ${id}. Clearing secret.`);
        await this.clearInvalidAuthConfig(scope, id, stored, revision);
      }
      return authConfig;
    } catch (error) {
      console.warn(`Invalid auth config for environment ${id}. Clearing secret.`, error);
      await this.clearInvalidAuthConfig(scope, id, stored, revision);
      return undefined;
    }
  }

  getAuthConfigRevision(scope: EnvironmentScope, id: string): number {
    return this.authConfigRevisions.get(this.getAuthRevisionKey(scope, id)) ?? 0;
  }

  /**
   * Keeps a stored record's `authHint` in step with the auth config just saved, so a copy of the
   * record on another machine (Settings Sync) knows to ask for sign-in. Deleting an auth config
   * keeps the hint on purpose; declared records take their hint from settings.
   */
  private recordAuthHint(
    scope: EnvironmentScope,
    id: string,
    authConfig: JenkinsAuthConfig
  ): Promise<void> {
    if (isDeclaredEnvironmentId(id)) {
      return Promise.resolve();
    }
    const write = this.mutationQueue(() =>
      this.writeAuthHint(scope, id, toEnvironmentAuthHint(authConfig))
    ).catch((error: unknown) => {
      console.warn(`Failed to record the sign-in method for environment ${id}.`, error);
    });
    // Auth writes made inside a record mutation (legacy migration, the URL-edit SSO rebase) would
    // deadlock waiting for it to finish; the hint lands right after that mutation instead.
    return this.activeRecordMutations > 0 ? Promise.resolve() : write;
  }

  /** Must run inside `mutationQueue`. Writes without firing a change: nothing visible changed. */
  private async writeAuthHint(
    scope: EnvironmentScope,
    id: string,
    hint: EnvironmentAuthHint | undefined
  ): Promise<void> {
    const environments = this.readStored(scope);
    const index = environments.findIndex((environment) => environment?.id === id);
    if (index < 0 || areAuthHintsEqual(environments[index].authHint, hint)) {
      return;
    }
    const next = [...environments];
    next[index] = withAuthHint(environments[index], hint);
    await getScopedMemento(this.context, scope).update(ENVIRONMENTS_KEY, next);
  }

  private async backfillAuthHintsForScope(scope: EnvironmentScope): Promise<void> {
    const memento = getScopedMemento(this.context, scope);
    if (memento.get<unknown>(AUTH_HINT_BACKFILL_VERSION_KEY) === AUTH_HINT_BACKFILL_VERSION) {
      return;
    }
    const candidates = this.readStored(scope).filter(
      (environment) =>
        typeof environment?.id === "string" &&
        !isDeclaredEnvironmentId(environment.id) &&
        environment.authHint === undefined
    );
    const hints = new Map<string, EnvironmentAuthHint>();
    let failed = false;
    await Promise.all(
      candidates.map(async ({ id }) => {
        try {
          const authConfig = await this.getAuthConfig(scope, id);
          const hint = authConfig ? toEnvironmentAuthHint(authConfig) : undefined;
          if (hint) {
            hints.set(id, hint);
          }
        } catch (error) {
          failed = true;
          console.warn(`Failed to read the sign-in method for environment ${id}.`, error);
        }
      })
    );
    if (hints.size > 0) {
      const next = this.readStored(scope).map((environment) => {
        const hint = environment?.authHint === undefined ? hints.get(environment?.id) : undefined;
        return hint ? withAuthHint(environment, hint) : environment;
      });
      await memento.update(ENVIRONMENTS_KEY, next);
    }
    if (!failed) {
      await memento.update(AUTH_HINT_BACKFILL_VERSION_KEY, AUTH_HINT_BACKFILL_VERSION);
    }
  }

  private readStored(scope: EnvironmentScope): JenkinsEnvironment[] {
    const stored = getScopedMemento(this.context, scope).get<JenkinsEnvironment[]>(
      ENVIRONMENTS_KEY
    );
    return Array.isArray(stored) ? stored : [];
  }

  private getVisibleDeclaredEnvironments(scope: EnvironmentScope): JenkinsEnvironment[] {
    const { declared } = this;
    if (!declared) {
      return [];
    }
    const storedByScope = {
      workspace: this.readStored("workspace"),
      global: this.readStored("global")
    };
    return declared.getDeclared(scope).flatMap((declaration) => {
      const local = declared.getLocalState(scope, declaration.id);
      if (local.hidden === true) {
        return [];
      }
      if (findSuppressingStored(declared, storedByScope, scope, declaration).length > 0) {
        // Suppressed until the user links or keeps the same-URL manual environment.
        return [];
      }
      return [toDeclaredEnvironmentRecord(declaration, local.previousUrls)];
    });
  }

  private resolveDeclaredUpdate(
    scope: EnvironmentScope,
    id: string,
    patch: JenkinsEnvironmentPatch,
    options: JenkinsEnvironmentUpdateOptions
  ): JenkinsEnvironmentUpdate | undefined {
    // Declared records are edited in settings; only no-op patches succeed here.
    if (
      patch.name !== undefined ||
      patch.url !== undefined ||
      patch.allowInsecureTls !== undefined ||
      patch.username !== undefined
    ) {
      return undefined;
    }
    const declaration = this.declared?.getDeclaration(scope, id);
    if (!declaration) {
      return undefined;
    }
    if (
      options.expectedTlsOrigin !== undefined &&
      getUrlOrigin(declaration.url) !== options.expectedTlsOrigin
    ) {
      return undefined;
    }
    const environment = toDeclaredEnvironmentRecord(
      declaration,
      this.declared?.getLocalState(scope, id).previousUrls
    );
    return { previous: environment, next: environment };
  }

  /**
   * Whether an auth config or legacy token is stored. Memoized until this store writes or deletes
   * either secret, or secrets change in another window.
   */
  private hasStoredCredentials(scope: EnvironmentScope, id: string): Promise<boolean> {
    const key = this.getAuthRevisionKey(scope, id);
    const revision = this.getAuthConfigRevision(scope, id);
    const generation = this.credentialGenerations.get(key) ?? 0;
    const epoch = this.credentialEpoch;
    const cached = this.credentialPresence.get(key);
    if (
      cached?.revision === revision &&
      cached.generation === generation &&
      cached.epoch === epoch
    ) {
      return cached.result;
    }
    const result = this.readCredentialPresence(scope, id);
    const entry: CredentialPresenceEntry = { revision, generation, epoch, result };
    this.credentialPresence.set(key, entry);
    result.catch(() => {
      if (this.credentialPresence.get(key) === entry) {
        this.credentialPresence.delete(key);
      }
    });
    return result;
  }

  private async readCredentialPresence(scope: EnvironmentScope, id: string): Promise<boolean> {
    const authConfig = await this.getAuthConfig(scope, id);
    return hasEnvironmentCredentials({
      authConfig,
      token: authConfig ? undefined : await this.getToken(scope, id)
    });
  }

  private async migrateLegacyAuthConfigsForScope(scope: EnvironmentScope): Promise<void> {
    const environments = await this.getStoredEnvironments(scope);
    const next = environments.map((environment) => ({ ...environment }));
    let didUpdate = false;

    await Promise.all(
      next.map(async (environment) => {
        const username = environment.username?.trim() ?? "";
        // Only legacy entries still carry a username; skip the keychain read for the rest.
        if (username.length === 0) {
          return;
        }
        const revision = this.getAuthConfigRevision(scope, environment.id);
        const existing = await this.getAuthConfig(scope, environment.id);

        if (!existing) {
          const token = await this.getToken(scope, environment.id);
          const trimmedToken = token?.trim() ?? "";
          if (trimmedToken.length > 0) {
            const authConfig: JenkinsAuthConfig = {
              type: "basic",
              username,
              token: trimmedToken
            };
            const saved = await this.setAuthConfigIfRevision(
              scope,
              environment.id,
              authConfig,
              revision
            );
            if (!saved) {
              return;
            }
            await this.deleteToken(scope, environment.id);
            environment.username = undefined;
            didUpdate = true;
            return;
          }
        }

        if (existing?.type === "basic") {
          environment.username = undefined;
          didUpdate = true;
        }
      })
    );

    if (didUpdate) {
      await this.saveEnvironments(scope, next);
    }
  }

  private async getTokenKey(scope: EnvironmentScope, id: string): Promise<string> {
    return `${TOKEN_KEY}.${await this.getSecretKeySuffix(scope, id)}`;
  }

  private async getAuthConfigKey(scope: EnvironmentScope, id: string): Promise<string> {
    return `${AUTH_CONFIG_KEY}.${await this.getSecretKeySuffix(scope, id)}`;
  }

  /**
   * `<scope>.<id>`, except for workspace-scoped declared environments: their ids come from
   * repository settings and repeat across workspaces, while SecretStorage is shared by all of
   * them, so they get `workspace.<namespace>.<id>`. Stored (UUID) ids keep the plain form.
   */
  private async getSecretKeySuffix(scope: EnvironmentScope, id: string): Promise<string> {
    if (scope !== "workspace" || !isDeclaredEnvironmentId(id)) {
      return `${scope}.${id}`;
    }
    return `${scope}.${await this.getWorkspaceSecretNamespace()}.${id}`;
  }

  private getWorkspaceSecretNamespace(): Promise<string> {
    this.workspaceSecretNamespace ??= (async () => {
      const memento = this.context.workspaceState;
      const stored = memento.get<unknown>(WORKSPACE_SECRET_NAMESPACE_KEY);
      if (typeof stored === "string" && stored.length > 0) {
        return stored;
      }
      const namespace = crypto.randomUUID();
      await memento.update(WORKSPACE_SECRET_NAMESPACE_KEY, namespace);
      return namespace;
    })().catch((error: unknown) => {
      this.workspaceSecretNamespace = undefined;
      throw error;
    });
    return this.workspaceSecretNamespace;
  }

  /**
   * In-memory bookkeeping is keyed by scope and id: a window has one workspace, so one secret
   * namespace, and these keys map one-to-one onto its secret keys.
   */
  private getAuthRevisionKey(scope: EnvironmentScope, id: string): string {
    return `${scope}:${id}`;
  }

  private bumpAuthConfigRevision(scope: EnvironmentScope, id: string): void {
    const key = this.getAuthRevisionKey(scope, id);
    const current = this.authConfigRevisions.get(key) ?? 0;
    this.authConfigRevisions.set(key, current + 1);
  }

  private bumpCredentialGeneration(scope: EnvironmentScope, id: string): void {
    const key = this.getAuthRevisionKey(scope, id);
    this.credentialGenerations.set(key, (this.credentialGenerations.get(key) ?? 0) + 1);
  }

  private async clearInvalidAuthConfig(
    scope: EnvironmentScope,
    id: string,
    invalidValue: string,
    revision: number
  ): Promise<void> {
    try {
      await this.authMutationQueue(async () => {
        if (this.getAuthConfigRevision(scope, id) !== revision) {
          return;
        }
        const key = await this.getAuthConfigKey(scope, id);
        if ((await this.context.secrets.get(key)) !== invalidValue) {
          return;
        }
        await this.deleteAuthConfigUnlocked(scope, id);
      });
    } catch (error) {
      console.warn(`Failed to clear invalid auth config for environment ${id}.`, error);
    }
  }

  private fireEnvironmentChange(
    kind: Extract<
      JenkinsEnvironmentStoreScopedChangeKind,
      "auth-config-updated" | "auth-config-deleted"
    >,
    scope: EnvironmentScope,
    environmentId: string
  ): void {
    this.emitter.fire(createScopedChange(kind, scope, environmentId));
  }
}

function createScopedChange(
  kind: JenkinsEnvironmentStoreScopedChangeKind,
  scope: EnvironmentScope,
  environmentId: string
): JenkinsEnvironmentStoreChange {
  return { kind, scope, environmentId };
}

/** Whether loaded secrets hold credentials: an auth config, or a non-blank legacy token. */
export function hasEnvironmentCredentials({
  authConfig,
  token
}: {
  authConfig?: JenkinsAuthConfig;
  token?: string;
}): boolean {
  return authConfig !== undefined || (token?.trim().length ?? 0) > 0;
}

function withAuthHint(
  environment: JenkinsEnvironment,
  hint: EnvironmentAuthHint | undefined
): JenkinsEnvironment {
  const next = { ...environment };
  if (hint) {
    next.authHint = hint;
  } else {
    delete next.authHint;
  }
  return next;
}

/** The environment record listed for a settings declaration. */
export function toDeclaredEnvironmentRecord(
  declaration: DeclaredEnvironmentRecord,
  previousUrls: readonly string[] | undefined
): JenkinsEnvironment {
  return {
    id: declaration.id,
    url: declaration.url,
    ...(declaration.name ? { name: declaration.name } : {}),
    ...(declaration.allowInsecureTls ? { allowInsecureTls: true } : {}),
    ...(declaration.authHint ? { authHint: declaration.authHint } : {}),
    ...(previousUrls && previousUrls.length > 0 ? { previousUrls: [...previousUrls] } : {}),
    source: "settings"
  };
}

function hasInsecureTls(environment: { allowInsecureTls?: boolean; url: string }): boolean {
  return (
    environment.allowInsecureTls === true &&
    getUrlOrigin(environment.url)?.startsWith("https://") === true
  );
}

function applyEnvironmentPatch(
  previous: JenkinsEnvironment,
  patch: JenkinsEnvironmentPatch
): JenkinsEnvironment {
  const next = { ...previous };
  if (patch.name !== undefined) {
    const name = patch.name?.trim() ?? "";
    if (name.length > 0) {
      next.name = name;
    } else {
      delete next.name;
    }
  }
  if (patch.username === null) {
    delete next.username;
  }

  if (patch.allowInsecureTls !== undefined) {
    if (patch.allowInsecureTls === true) {
      next.allowInsecureTls = true;
    } else {
      delete next.allowInsecureTls;
    }
  }

  if (patch.url === undefined || patch.url === previous.url) {
    return next;
  }
  next.url = patch.url;
  if (getUrlOrigin(previous.url) !== getUrlOrigin(next.url) || !getUrlOrigin(next.url)) {
    delete next.allowInsecureTls;
  }
  const newBase = ensureTrailingSlash(patch.url);
  const previousUrls = [
    // Legacy URLs may embed credentials; never copy them into plain extension state.
    ensureTrailingSlash(stripUrlCredentials(previous.url)),
    ...(previous.previousUrls ?? [])
  ].filter((url, position, all) => url !== newBase && all.indexOf(url) === position);
  next.previousUrls = previousUrls.slice(0, MAX_PREVIOUS_URLS);
  return next;
}
