import type { JenkinsClientProvider } from "../../jenkins/JenkinsClientProvider";
import { getUrlOrigin } from "../../jenkins/urls";
import {
  type DeclaredEnvironmentView,
  getExpectedOriginAcknowledgment,
  isDeclaredEnvironmentId,
  isOriginAcknowledged,
  matchDeclaredWithStored
} from "../../storage/DeclaredEnvironmentView";
import { toOriginAcknowledgment } from "../../storage/EnvironmentAuthHint";
import {
  type EnvironmentScope,
  type EnvironmentWithScope,
  type JenkinsEnvironment,
  type JenkinsEnvironmentStore,
  toDeclaredEnvironmentRecord
} from "../../storage/JenkinsEnvironmentStore";
import type { DeclaredEnvironment, DeclaredEnvironmentSource } from "./DeclaredEnvironmentSource";
import type {
  DeclaredEnvironmentStateReader,
  DeclaredEnvironmentStateStore,
  DeclaredEnvironmentUrlChange
} from "./DeclaredEnvironmentStateStore";

export interface DeclaredEnvironmentRegistryDependencies {
  source: Pick<DeclaredEnvironmentSource, "getDeclared" | "getDeclaration">;
  /** The writable store; everything else reads it as a `DeclaredEnvironmentStateReader`. */
  state: DeclaredEnvironmentStateStore;
  environmentStore: Pick<
    JenkinsEnvironmentStore,
    "getStoredEnvironments" | "getAuthConfig" | "deleteToken" | "deleteAuthConfig" | "fireChange"
  >;
  /**
   * The sign-in requirement is checked when a client is cached, so every acknowledged-origin or
   * visibility write drops the affected clients. Pass a lazy reference.
   */
  clientProvider: Pick<JenkinsClientProvider, "invalidateClient">;
}

export type HiddenEnvironment = EnvironmentWithScope & { hidden: "declared" | "stored" };

/** The read-only view of declarations and their local state that the environment store needs. */
export function createDeclaredEnvironmentView({
  source,
  state
}: {
  source: Pick<DeclaredEnvironmentSource, "getDeclared" | "getDeclaration">;
  state: DeclaredEnvironmentStateReader;
}): DeclaredEnvironmentView {
  return {
    getDeclared: (scope) => source.getDeclared(scope),
    getDeclaration: (scope, id) => source.getDeclaration(scope, id),
    getLocalState: (scope, id) => state.get(scope, id),
    isStoredHidden: (scope, id) => state.isStoredHidden(scope, id)
  };
}

/**
 * Operations on settings-declared environments and the user's local state for them: confirming a
 * server, hiding and showing, keeping a same-URL manual environment separate, and announcing
 * settings changes. It is the only writer of declared local state (`acknowledgedOrigin`, `hidden`,
 * `adoptDeclined`, hidden stored ids, previous URLs); each write drops the cached clients it
 * affects and fires the environment store's change event where the listed environments change.
 */
export class DeclaredEnvironmentRegistry {
  constructor(private readonly dependencies: DeclaredEnvironmentRegistryDependencies) {}

  /** The current settings declaration behind a declared id, whether visible or not. */
  getDeclaration(scope: EnvironmentScope, id: string): DeclaredEnvironment | undefined {
    return this.dependencies.source.getDeclaration(scope, id);
  }

  /**
   * What the user last confirmed for a declared environment, if anything: a value from
   * `toOriginAcknowledgment` (server origin, plus `|<sign-in page origin>` for a separate SSO page).
   */
  getAcknowledgedOrigin(scope: EnvironmentScope, id: string): string | undefined {
    return isDeclaredEnvironmentId(id)
      ? this.dependencies.state.get(scope, id).acknowledgedOrigin
      : undefined;
  }

  /**
   * The acknowledgment the current declaration needs (see `getExpectedOriginAcknowledgment`), or
   * undefined when it is not declared or its URL does not parse. Flows that ask the user read it
   * with the environment they show and pass it to `acknowledgeOrigin` as `expected`.
   */
  getExpectedAcknowledgment(scope: EnvironmentScope, id: string): string | undefined {
    const declaration = isDeclaredEnvironmentId(id)
      ? this.dependencies.source.getDeclaration(scope, id)
      : undefined;
    return declaration ? getExpectedOriginAcknowledgment(declaration) : undefined;
  }

  /**
   * Whether the user's confirmation covers the declaration as it stands now; the same test
   * `JenkinsEnvironmentStore.getSignInRequirement` makes. False when it is not declared.
   */
  isOriginAcknowledged(scope: EnvironmentScope, id: string): boolean {
    const declaration = isDeclaredEnvironmentId(id)
      ? this.dependencies.source.getDeclaration(scope, id)
      : undefined;
    return (
      declaration !== undefined &&
      isOriginAcknowledged(declaration, this.dependencies.state.get(scope, id))
    );
  }

  /**
   * Records that the user confirmed connecting to a declared environment's server (and its
   * separate SSO sign-in page, if any). With `expected`, records nothing unless the declaration
   * still yields that acknowledgment, so a settings edit made while a confirmation was open is
   * not confirmed unseen. With `loginPage: "from-credentials"` the sign-in page counts as
   * confirmed only when the stored SSO credentials already use the same origin. Returns whether
   * the acknowledgment was recorded.
   */
  async acknowledgeOrigin(
    scope: EnvironmentScope,
    id: string,
    options: { expected?: string; loginPage?: "confirmed" | "from-credentials" } = {}
  ): Promise<boolean> {
    const { source, state, environmentStore } = this.dependencies;
    const declaration = source.getDeclaration(scope, id);
    let acknowledgment = declaration ? getExpectedOriginAcknowledgment(declaration) : undefined;
    if (
      !declaration ||
      !acknowledgment ||
      (options.expected !== undefined && options.expected !== acknowledgment)
    ) {
      return false;
    }
    if (options.loginPage === "from-credentials") {
      const authConfig = await environmentStore.getAuthConfig(scope, id);
      const credentialsAcknowledgment =
        authConfig?.type === "sso"
          ? toOriginAcknowledgment(declaration.url, {
              type: "sso",
              loginUrl: authConfig.loginUrl
            })
          : undefined;
      if (credentialsAcknowledgment !== acknowledgment) {
        acknowledgment = getUrlOrigin(declaration.url) ?? acknowledgment;
      }
    }
    await state.acknowledgeOrigin(scope, id, acknowledgment);
    this.invalidate(scope, id);
    return true;
  }

  /**
   * Puts back the acknowledgment that preceded one of our own writes (adoption rollback). With
   * `onlyIf`, does nothing when the stored acknowledgment is no longer that value, so a later
   * sign-in or confirmation stays. Returns whether it was restored.
   */
  async restoreAcknowledgedOrigin(
    scope: EnvironmentScope,
    id: string,
    previous: string | undefined,
    options: { onlyIf?: string } = {}
  ): Promise<boolean> {
    if (
      !isDeclaredEnvironmentId(id) ||
      ("onlyIf" in options && this.getAcknowledgedOrigin(scope, id) !== options.onlyIf)
    ) {
      return false;
    }
    await this.dependencies.state.update(scope, id, { acknowledgedOrigin: previous });
    // A client built while the acknowledgment stood would otherwise outlive it.
    this.invalidate(scope, id);
    return true;
  }

  /** Records declared URL changes as previous URLs; returns the declarations whose URL moved. */
  // fallow-ignore-next-line unused-class-member -- called through the coordinator registry dependency
  reconcileUrls(declared: readonly DeclaredEnvironment[]): Promise<DeclaredEnvironmentUrlChange[]> {
    return this.dependencies.state.reconcileUrls(declared);
  }

  /**
   * Hides a declared environment for this user and deletes its credentials. Showing it again
   * starts over: confirm the server and sign in afresh. Returns false when it is not declared.
   */
  async hideDeclaredEnvironment(scope: EnvironmentScope, id: string): Promise<boolean> {
    const { source, state, environmentStore } = this.dependencies;
    if (!isDeclaredEnvironmentId(id) || !source.getDeclaration(scope, id)) {
      return false;
    }
    await state.update(scope, id, { hidden: true, acknowledgedOrigin: undefined });
    this.invalidate(scope, id);
    environmentStore.fireChange({ kind: "environment-removed", scope, environmentId: id });
    await environmentStore.deleteToken(scope, id);
    await environmentStore.deleteAuthConfig(scope, id);
    return true;
  }

  /**
   * Hides a stored environment in this workspace only (linked to a shared definition from
   * another scope). Fires nothing: the caller announces the link once it is complete, and
   * listeners must not treat the record as removed.
   */
  async hideStoredEnvironment(scope: EnvironmentScope, id: string): Promise<void> {
    await this.dependencies.state.hideStored(scope, id);
    this.invalidate(scope, id);
  }

  /**
   * Environments the user hid in this window: declared ones hidden in either scope, and stored
   * ones hidden in this workspace because they were linked to a shared definition.
   */
  async listHiddenEnvironments(): Promise<HiddenEnvironment[]> {
    const { source, state, environmentStore } = this.dependencies;
    const declared = state.listHidden().flatMap(({ scope, id }): HiddenEnvironment[] => {
      const declaration = source.getDeclaration(scope, id);
      return declaration
        ? [
            {
              ...toDeclaredEnvironmentRecord(declaration, state.get(scope, id).previousUrls),
              scope,
              hidden: "declared"
            }
          ]
        : [];
    });
    const hiddenStored = state.listHiddenStored();
    const scopes = new Set(hiddenStored.map(({ scope }) => scope));
    const storedByScope = new Map(
      await Promise.all(
        [...scopes].map(async (scope) => {
          const environments = await environmentStore.getStoredEnvironments(scope);
          const byId = new Map<string, JenkinsEnvironment>();
          for (const entry of environments) {
            if (entry && !byId.has(entry.id)) {
              byId.set(entry.id, entry);
            }
          }
          return [scope, byId] as const;
        })
      )
    );
    const stored = hiddenStored.flatMap(({ scope, id }): HiddenEnvironment[] => {
      const environment = storedByScope.get(scope)?.get(id);
      return environment ? [{ ...environment, scope, hidden: "stored" }] : [];
    });
    return [...declared, ...stored];
  }

  /** Reverses `hideDeclaredEnvironment` or `hideStoredEnvironment`. */
  async unhideEnvironment(scope: EnvironmentScope, id: string): Promise<void> {
    const { state, environmentStore } = this.dependencies;
    if (isDeclaredEnvironmentId(id)) {
      await state.setHidden(scope, id, false);
    } else {
      // The user asked to see this record again; a same-URL declaration would otherwise be
      // suppressed by it, so keep both listed.
      await this.keepDeclarationsSeparateFrom(scope, id);
      await state.unhideStored(scope, id);
    }
    this.invalidate(scope, id);
    environmentStore.fireChange({ kind: "environment-added", scope, environmentId: id });
  }

  /**
   * Keeps a declaration listed beside the same-URL manual environment instead of offering to link
   * them. Fires `bulk-update`: the declaration is no longer suppressed.
   */
  async keepSeparate(declared: { scope: EnvironmentScope; id: string }): Promise<void> {
    await this.dependencies.state.update(declared.scope, declared.id, { adoptDeclined: true });
    this.notifyDeclaredEnvironmentsChanged();
  }

  /**
   * Announces that settings declarations changed. The declared-environment coordinator calls this
   * after reconciling local state, so listeners see the new previous URLs.
   */
  notifyDeclaredEnvironmentsChanged(): void {
    this.dependencies.environmentStore.fireChange({ kind: "bulk-update" });
  }

  /**
   * Announces that a declared environment's URL or TLS policy changed in settings, through the
   * same `environment-updated` event a stored edit fires, so open panels and pollers holding the
   * old reference are closed or repointed. No-op when the declaration is gone or hidden.
   */
  notifyDeclaredEnvironmentUpdated(
    scope: EnvironmentScope,
    id: string,
    change: { urlChanged: boolean; tlsPolicyChanged?: boolean }
  ): void {
    const { source, state, environmentStore } = this.dependencies;
    const declaration = source.getDeclaration(scope, id);
    const local = state.get(scope, id);
    if (!declaration || local.hidden === true) {
      return;
    }
    environmentStore.fireChange({
      kind: "environment-updated",
      scope,
      environmentId: id,
      urlChanged: change.urlChanged,
      ...(change.tlsPolicyChanged ? { tlsPolicyChanged: true } : {}),
      environment: toDeclaredEnvironmentRecord(declaration, local.previousUrls)
    });
  }

  /**
   * Marks every declaration (in either scope, hidden or not) that stored record `id` would
   * suppress once shown as kept separate from it, so showing the record does not suppress them.
   */
  private async keepDeclarationsSeparateFrom(scope: EnvironmentScope, id: string): Promise<void> {
    const { source, state, environmentStore } = this.dependencies;
    const environment = (await environmentStore.getStoredEnvironments(scope)).find(
      (entry) => entry?.id === id
    );
    if (!environment) {
      return;
    }
    const view = createDeclaredEnvironmentView({ source, state });
    // The record is still hidden here; match it as it will be once shown.
    const shown: DeclaredEnvironmentView = {
      ...view,
      isStoredHidden: (storedScope, storedId) =>
        !(storedScope === scope && storedId === id) && view.isStoredHidden(storedScope, storedId)
    };
    const storedByScope: Record<EnvironmentScope, JenkinsEnvironment[]> = {
      workspace: [],
      global: []
    };
    storedByScope[scope] = [environment];
    for (const { declaredScope, declared } of matchDeclaredWithStored(shown, storedByScope, {
      includeHidden: true
    })) {
      // eslint-disable-next-line react-doctor/async-await-in-loop -- Finish each queued declaration write before attempting the next.
      await state.update(declaredScope, declared.id, { adoptDeclined: true });
    }
  }

  private invalidate(scope: EnvironmentScope, id: string): void {
    this.dependencies.clientProvider.invalidateClient(scope, id);
  }
}
