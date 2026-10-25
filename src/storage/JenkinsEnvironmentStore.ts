import * as vscode from "vscode";
import { parseAuthConfig } from "../jenkins/auth";
import type { JenkinsAuthConfig } from "../jenkins/types";
import { ensureTrailingSlash, stripUrlCredentials } from "../jenkins/urls";
import { createSerialTaskQueue } from "./SerialTaskQueue";
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
}

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

const ENVIRONMENTS_KEY = "jenkinsWorkbench.environments";
const AUTH_CONFIG_KEY = "jenkinsWorkbench.envAuthConfig";
const MAX_PREVIOUS_URLS = 5;

export class JenkinsEnvironmentStore {
  private readonly authConfigRevisions = new Map<string, number>();
  private readonly authMutationQueue = createSerialTaskQueue();
  private readonly mutationQueue = createSerialTaskQueue();
  private readonly emitter = new vscode.EventEmitter<JenkinsEnvironmentStoreChange>();

  readonly onDidChange = this.emitter.event;

  constructor(private readonly context: vscode.ExtensionContext) {}

  getEnvironments(scope: EnvironmentScope): Promise<JenkinsEnvironment[]> {
    const memento = getScopedMemento(this.context, scope);
    const stored = memento.get<JenkinsEnvironment[]>(ENVIRONMENTS_KEY);
    return Promise.resolve(Array.isArray(stored) ? stored : []);
  }

  /** Resolves TLS policy from current state rather than a potentially stale environment reference. */
  getAllowInsecureTls(scope: EnvironmentScope, id: string, url: string): boolean {
    const stored = getScopedMemento(this.context, scope).get<JenkinsEnvironment[]>(
      ENVIRONMENTS_KEY
    );
    const environment = Array.isArray(stored)
      ? stored.find((entry) => entry?.id === id)
      : undefined;
    return (
      environment !== undefined &&
      hasInsecureTls(environment) &&
      getUrlOrigin(environment.url) === getUrlOrigin(url)
    );
  }

  async saveEnvironments(
    scope: EnvironmentScope,
    environments: JenkinsEnvironment[],
    change: JenkinsEnvironmentStoreChange = { kind: "bulk-update", scope }
  ): Promise<void> {
    const memento = getScopedMemento(this.context, scope);
    await memento.update(ENVIRONMENTS_KEY, environments);
    this.emitter.fire(change);
  }

  addEnvironment(
    scope: EnvironmentScope,
    environment: JenkinsEnvironment,
    token?: string
  ): Promise<void> {
    return this.mutationQueue(async () => {
      const environments = [...(await this.getEnvironments(scope))];
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

  removeEnvironment(scope: EnvironmentScope, id: string): Promise<boolean> {
    return this.mutationQueue(async () => {
      const environments = await this.getEnvironments(scope);
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
      const environments = [...(await this.getEnvironments(scope))];
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

  // fallow-ignore-next-line unused-class-member
  async migrateLegacyAuthConfigs(): Promise<void> {
    await Promise.all([
      this.mutationQueue(() => this.migrateLegacyAuthConfigsForScope("workspace")),
      this.mutationQueue(() => this.migrateLegacyAuthConfigsForScope("global"))
    ]);
  }

  async setToken(scope: EnvironmentScope, id: string, token: string): Promise<void> {
    await this.context.secrets.store(this.getTokenKey(scope, id), token);
  }

  async deleteToken(scope: EnvironmentScope, id: string): Promise<void> {
    await this.context.secrets.delete(this.getTokenKey(scope, id));
  }

  async getToken(scope: EnvironmentScope, id: string): Promise<string | undefined> {
    return this.context.secrets.get(this.getTokenKey(scope, id));
  }

  setAuthConfig(scope: EnvironmentScope, id: string, authConfig: JenkinsAuthConfig): Promise<void> {
    return this.authMutationQueue(() => this.setAuthConfigUnlocked(scope, id, authConfig));
  }

  /**
   * Stores the auth config only if no other auth mutation has happened since
   * `expectedRevision` was read. Returns whether the config was stored.
   */
  setAuthConfigIfRevision(
    scope: EnvironmentScope,
    id: string,
    authConfig: JenkinsAuthConfig,
    expectedRevision: number
  ): Promise<boolean> {
    return this.authMutationQueue(async () => {
      if (this.getAuthConfigRevision(scope, id) !== expectedRevision) {
        return false;
      }
      await this.setAuthConfigUnlocked(scope, id, authConfig);
      return true;
    });
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
    await this.context.secrets.store(this.getAuthConfigKey(scope, id), JSON.stringify(authConfig));
    this.fireEnvironmentChange("auth-config-updated", scope, id);
  }

  private async deleteAuthConfigUnlocked(scope: EnvironmentScope, id: string): Promise<void> {
    this.bumpAuthConfigRevision(scope, id);
    await this.context.secrets.delete(this.getAuthConfigKey(scope, id));
    this.fireEnvironmentChange("auth-config-deleted", scope, id);
  }

  async getAuthConfig(scope: EnvironmentScope, id: string): Promise<JenkinsAuthConfig | undefined> {
    const revision = this.getAuthConfigRevision(scope, id);
    const stored = await this.context.secrets.get(this.getAuthConfigKey(scope, id));
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

  private async migrateLegacyAuthConfigsForScope(scope: EnvironmentScope): Promise<void> {
    const environments = await this.getEnvironments(scope);
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

  private getTokenKey(scope: EnvironmentScope, id: string): string {
    return `jenkinsWorkbench.envToken.${scope}.${id}`;
  }

  private getAuthConfigKey(scope: EnvironmentScope, id: string): string {
    return `${AUTH_CONFIG_KEY}.${scope}.${id}`;
  }

  private getAuthRevisionKey(scope: EnvironmentScope, id: string): string {
    return `${scope}:${id}`;
  }

  private bumpAuthConfigRevision(scope: EnvironmentScope, id: string): void {
    const key = this.getAuthRevisionKey(scope, id);
    const current = this.authConfigRevisions.get(key) ?? 0;
    this.authConfigRevisions.set(key, current + 1);
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
        if ((await this.context.secrets.get(this.getAuthConfigKey(scope, id))) !== invalidValue) {
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

function getUrlOrigin(url: string): string | undefined {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

function hasInsecureTls(environment: JenkinsEnvironment): boolean {
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
