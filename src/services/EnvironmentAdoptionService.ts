import * as vscode from "vscode";
import type { DeclaredEnvironmentRegistry } from "../environments/sharing/DeclaredEnvironmentRegistry";
import type {
  DeclaredEnvironment,
  DeclaredEnvironmentSource
} from "../environments/sharing/DeclaredEnvironmentSource";
import type { DeclaredEnvironmentStateReader } from "../environments/sharing/DeclaredEnvironmentStateStore";
import type { ExtensionRefreshHost } from "../extension/ExtensionRefreshHost";
import { formatEnvironmentDisplayName } from "../jenkins/EnvironmentLabels";
import type { JenkinsClientProvider } from "../jenkins/JenkinsClientProvider";
import { ensureTrailingSlash, stripUrlCredentials } from "../jenkins/urls";
import {
  getExpectedOriginAcknowledgment,
  matchDeclaredWithStored,
  toComparableEnvironmentUrl
} from "../storage/DeclaredEnvironmentView";
import type {
  EnvironmentRecordsCopy,
  EnvironmentRecordsRef
} from "../storage/EnvironmentRecordCopy";
import {
  type EnvironmentRecordParticipant,
  removeAllEnvironmentRecords,
  toLabelledRecordError
} from "../storage/EnvironmentRecordParticipant";
import type {
  EnvironmentScope,
  EnvironmentWithScope,
  JenkinsEnvironmentStore
} from "../storage/JenkinsEnvironmentStore";
import { createSerialTaskQueue } from "../storage/SerialTaskQueue";
import type { EnvironmentUrlRebaseService } from "./EnvironmentUrlRebaseService";

export interface EnvironmentAdoptionDependencies {
  source: Pick<DeclaredEnvironmentSource, "getDeclared">;
  /** Read-only: declared local state is written through `registry`. */
  state: DeclaredEnvironmentStateReader;
  registry: Pick<
    DeclaredEnvironmentRegistry,
    | "acknowledgeOrigin"
    | "getAcknowledgedOrigin"
    | "restoreAcknowledgedOrigin"
    | "hideStoredEnvironment"
    | "keepSeparate"
    | "notifyDeclaredEnvironmentsChanged"
  >;
  environmentStore: Pick<
    JenkinsEnvironmentStore,
    | "getStoredEnvironments"
    | "getAuthConfig"
    | "getAuthConfigRevision"
    | "setAuthConfig"
    | "deleteAuthConfig"
    | "getToken"
    | "setToken"
    | "deleteToken"
    | "removeEnvironment"
  >;
  /** Every per-environment record kind besides credentials; see `EnvironmentRecordParticipant`. */
  participants: readonly EnvironmentRecordParticipant[];
  /** Rebases copied records onto the declared URL. */
  urlRebaseService: Pick<EnvironmentUrlRebaseService, "rebase">;
  clientProvider: Pick<JenkinsClientProvider, "invalidateClient">;
  refreshHost: Pick<ExtensionRefreshHost, "fullEnvironmentRefresh" | "onEnvironmentRemoved">;
}

/** A settings declaration and a manual environment for the same server. */
export interface AdoptionCandidate {
  declared: DeclaredEnvironment;
  stored: EnvironmentWithScope;
}

export type AdoptionResult =
  /** Linked; `warnings` lists leftovers that could not be cleaned up or rebased. */
  | { status: "adopted"; warnings: Error[] }
  /** Nothing changed: copies were rolled back and the manual environment kept. */
  | { status: "failed"; failures: Error[]; rollbackFailures: Error[] }
  /** The pair no longer matches (settings or the manual environment changed). */
  | { status: "unavailable" };

const LINK = "Link to Shared Definition";
const KEEP_SEPARATE = "Keep Separate";
const LATER = "Later";

/**
 * Links a manual environment to a settings declaration for the same server: copies its
 * credentials and every per-environment record to the declared id, then removes the manual
 * record (same scope) or hides it in this workspace (different scope). Any copy failure rolls
 * back what was copied and keeps the manual environment.
 */
export class EnvironmentAdoptionService {
  private readonly adoptQueue = createSerialTaskQueue();
  private readonly openPrompts = new Set<string>();
  private readonly suppressedPrompts = new Map<string, number>();

  constructor(private readonly dependencies: EnvironmentAdoptionDependencies) {}

  /**
   * Declarations with a visible manual environment for the same server that the user has not
   * kept separate. While such a pair exists the declaration is not listed.
   */
  findCandidates(): Promise<AdoptionCandidate[]> {
    return this.collectCandidates(false);
  }

  /** Adopts one pair. Serialized with other adoptions; shows no UI. */
  adopt(candidate: AdoptionCandidate): Promise<AdoptionResult> {
    return this.adoptQueue(() => this.adoptUnlocked(candidate));
  }

  /**
   * Adopts the manual environment matching a declaration without asking, for flows where the
   * user just shared that environment in settings. `stored` picks the manual environment when
   * several match. Failures are reported to the user and returned.
   */
  // fallow-ignore-next-line unused-class-member -- called through sharing command dependencies
  async adoptWithoutPrompt(
    declaredScope: EnvironmentScope,
    declaredId: string,
    stored?: { scope: EnvironmentScope; id: string }
  ): Promise<AdoptionResult> {
    const suppression = this.suppressPromptFor(declaredScope, declaredId);
    try {
      const candidate = (await this.collectCandidates(true)).find(
        (entry) =>
          entry.declared.scope === declaredScope &&
          entry.declared.id === declaredId &&
          (!stored || (entry.stored.scope === stored.scope && entry.stored.id === stored.id))
      );
      if (!candidate) {
        return { status: "unavailable" };
      }
      const result = await this.adopt(candidate);
      this.report(candidate, result, false);
      return result;
    } finally {
      suppression.dispose();
    }
  }

  /**
   * Keeps `promptForCandidates` from asking about a declaration, e.g. while a share flow writes
   * it to settings and adopts it itself. Dispose to allow prompts again.
   */
  suppressPromptFor(declaredScope: EnvironmentScope, declaredId: string): vscode.Disposable {
    const key = toKey(declaredScope, declaredId);
    this.suppressedPrompts.set(key, (this.suppressedPrompts.get(key) ?? 0) + 1);
    let disposed = false;
    return {
      dispose: () => {
        if (disposed) {
          return;
        }
        disposed = true;
        const count = (this.suppressedPrompts.get(key) ?? 1) - 1;
        if (count > 0) {
          this.suppressedPrompts.set(key, count);
        } else {
          this.suppressedPrompts.delete(key);
        }
      }
    };
  }

  /**
   * Asks about each candidate with a non-modal message and returns once the messages are shown.
   * A pair whose message is still open is not asked again; "Later" persists nothing, so the
   * next activation or settings change asks again.
   */
  // fallow-ignore-next-line unused-class-member -- called through the coordinator adoption dependency
  async promptForCandidates(): Promise<void> {
    // Let a running adoption finish so its pair is not offered again.
    const candidates = await this.adoptQueue(() => this.findCandidates());
    for (const candidate of candidates) {
      const key = toPairKey(candidate);
      if (
        this.openPrompts.has(key) ||
        this.suppressedPrompts.has(toKey(candidate.declared.scope, candidate.declared.id))
      ) {
        continue;
      }
      this.openPrompts.add(key);
      void this.prompt(candidate)
        .catch((error) => {
          console.warn("Failed to link a Jenkins environment to its shared definition.", error);
        })
        .finally(() => {
          this.openPrompts.delete(key);
        });
    }
  }

  private async prompt(candidate: AdoptionCandidate): Promise<void> {
    const { declared } = candidate;
    const location = declared.scope === "workspace" ? "workspace" : "user";
    const choice = await vscode.window.showInformationMessage(
      `${formatTitle(candidate.stored)} is now shared in ${location} settings as '${declared.slug}'. Link your existing environment to the shared definition? Your credentials, pins and watches are carried over.`,
      LINK,
      KEEP_SEPARATE,
      LATER
    );
    if (choice === LINK) {
      this.report(candidate, await this.adopt(candidate), true);
    } else if (choice === KEEP_SEPARATE) {
      await this.keepSeparate(declared);
    }
    // "Later" or dismissed: nothing is stored.
  }

  private async keepSeparate(declared: DeclaredEnvironment): Promise<void> {
    // The declaration is no longer suppressed; list it beside the manual environment.
    await this.dependencies.registry.keepSeparate(declared);
    this.dependencies.refreshHost.fullEnvironmentRefresh({ trigger: "system" });
  }

  private report(
    candidate: AdoptionCandidate,
    result: AdoptionResult,
    announceSuccess: boolean
  ): void {
    const title = formatTitle(candidate.stored);
    const slug = candidate.declared.slug;
    if (result.status === "adopted") {
      if (result.warnings.length > 0) {
        void vscode.window.showWarningMessage(
          `Linked ${title} to the shared definition '${slug}', but some old data could not be cleaned up: ${formatErrors(result.warnings)}`
        );
      } else if (announceSuccess) {
        void vscode.window.showInformationMessage(
          `Linked ${title} to the shared definition '${slug}'.`
        );
      }
      return;
    }
    if (result.status === "unavailable") {
      void vscode.window.showWarningMessage(
        `${title} no longer matches the shared definition '${slug}'. Nothing was changed.`
      );
      return;
    }
    const rollback =
      result.rollbackFailures.length > 0
        ? ` Some copied data could not be removed: ${formatErrors(result.rollbackFailures)}`
        : "";
    void vscode.window.showErrorMessage(
      `Could not link ${title} to the shared definition '${slug}'. Your existing environment was kept: ${formatErrors(result.failures)}${rollback}`
    );
  }

  private async collectCandidates(includeDeclined: boolean): Promise<AdoptionCandidate[]> {
    const { source, state, environmentStore } = this.dependencies;
    const [workspace, global] = await Promise.all([
      environmentStore.getStoredEnvironments("workspace"),
      environmentStore.getStoredEnvironments("global")
    ]);
    return matchDeclaredWithStored(
      {
        getDeclared: (scope) => source.getDeclared(scope),
        getLocalState: (scope, id) => state.get(scope, id),
        isStoredHidden: (scope, id) => state.isStoredHidden(scope, id)
      },
      { workspace, global },
      { includeDeclined }
    ).map(({ declared, stored }) => ({ declared, stored }));
  }

  /** The candidate as it stands now, or undefined if either side changed. */
  private async resolveCurrent(
    candidate: AdoptionCandidate
  ): Promise<AdoptionCandidate | undefined> {
    const key = toPairKey(candidate);
    const current = (await this.collectCandidates(true)).find((entry) => toPairKey(entry) === key);
    const declaredUrl = toComparableEnvironmentUrl(candidate.declared.url);
    // Both still exist and match each other; the declaration must also not have moved.
    return current && toComparableEnvironmentUrl(current.declared.url) === declaredUrl
      ? current
      : undefined;
  }

  private async adoptUnlocked(requested: AdoptionCandidate): Promise<AdoptionResult> {
    const candidate = await this.resolveCurrent(requested);
    if (!candidate) {
      return { status: "unavailable" };
    }
    const { declared, stored } = candidate;
    const from: EnvironmentRecordsRef = { scope: stored.scope, environmentId: stored.id };
    const to: EnvironmentRecordsRef = { scope: declared.scope, environmentId: declared.id };

    const steps = this.copySteps(candidate, from, to);
    // Wrap so a store that throws synchronously is reported like a rejected one.
    const results = await Promise.allSettled(steps.map(async ([, run]) => run()));
    const copies: EnvironmentRecordsCopy[] = [];
    const failures: Error[] = [];
    results.forEach((result, index) => {
      if (result.status === "fulfilled") {
        copies.push(result.value);
      } else {
        failures.push(toLabelledRecordError(steps[index][0], result.reason));
      }
    });
    if (failures.length > 0) {
      return this.rollBack(copies, failures);
    }

    const { registry } = this.dependencies;
    try {
      // The user already trusted this server under the manual environment; a separate SSO
      // sign-in page counts only when the copied credentials sign in there already. Only the
      // declaration that was matched may be acknowledged, and rollback must restore the old value.
      const acknowledgment = await this.acknowledgeMatchedDeclaration(declared);
      if (!acknowledgment) {
        const rolledBack = await this.rollBack(copies, []);
        return rolledBack.status === "failed" && rolledBack.rollbackFailures.length > 0
          ? rolledBack
          : { status: "unavailable" };
      }
      copies.push(acknowledgment);
    } catch (error) {
      return this.rollBack(copies, [toLabelledRecordError("shared definition", error)]);
    }

    // An edit that landed while copying (e.g. a new URL) must not be linked or removed.
    if (!(await this.resolveCurrent(candidate))) {
      const rolledBack = await this.rollBack(copies, []);
      return rolledBack.status === "failed" && rolledBack.rollbackFailures.length > 0
        ? rolledBack
        : { status: "unavailable" };
    }

    const cleanup = await this.removeManualEnvironment(candidate, copies, from);
    if ("status" in cleanup) {
      return cleanup;
    }
    const { warnings } = cleanup;

    warnings.push(...(await this.rebaseOntoDeclaredUrl(candidate)));
    const { clientProvider, refreshHost } = this.dependencies;
    clientProvider.invalidateClient(stored.scope, stored.id);
    clientProvider.invalidateClient(declared.scope, declared.id);
    registry.notifyDeclaredEnvironmentsChanged();
    refreshHost.fullEnvironmentRefresh({ trigger: "system" });
    return { status: "adopted", warnings };
  }

  private async removeManualEnvironment(
    candidate: AdoptionCandidate,
    copies: EnvironmentRecordsCopy[],
    from: EnvironmentRecordsRef
  ): Promise<{ warnings: Error[] } | AdoptionResult> {
    const { stored, declared } = candidate;
    const { environmentStore, registry } = this.dependencies;
    const warnings: Error[] = [];
    if (stored.scope === declared.scope) {
      try {
        await environmentStore.removeEnvironment(stored.scope, stored.id);
      } catch (error) {
        const remaining = await environmentStore.getStoredEnvironments(stored.scope);
        if (remaining.some((environment) => environment.id === stored.id)) {
          return this.rollBack(copies, [toLabelledRecordError("manual environment", error)]);
        }
        warnings.push(toLabelledRecordError("manual environment", error));
      }
      // Copies under the declared id stay; re-pointed records no longer match the old id.
      warnings.push(...(await removeAllEnvironmentRecords(this.dependencies.participants, from)));
      this.dependencies.refreshHost.onEnvironmentRemoved?.({
        environmentId: stored.id,
        scope: stored.scope,
        url: stored.url
      });
    } else {
      try {
        // The manual environment stays for other workspaces; only this one switches over.
        await registry.hideStoredEnvironment(stored.scope, stored.id);
      } catch (error) {
        return this.rollBack(copies, [toLabelledRecordError("manual environment", error)]);
      }
    }

    return { warnings };
  }

  private copySteps(
    candidate: AdoptionCandidate,
    from: EnvironmentRecordsRef,
    to: EnvironmentRecordsRef
  ): Array<[label: string, run: () => Promise<EnvironmentRecordsCopy>]> {
    return [
      ["credentials", () => this.copyCredentials(candidate, from, to)],
      ...this.dependencies.participants.map(
        (participant): [string, () => Promise<EnvironmentRecordsCopy>] => [
          participant.label,
          () => participant.copyEnvironmentRecords(from, to)
        ]
      )
    ];
  }

  /**
   * Copies the auth config and legacy token. Credentials the declared environment already has
   * (the user signed in to it) are kept.
   */
  private async copyCredentials(
    candidate: AdoptionCandidate,
    from: EnvironmentRecordsRef,
    to: EnvironmentRecordsRef
  ): Promise<EnvironmentRecordsCopy> {
    const { environmentStore } = this.dependencies;
    const undo: Array<() => Promise<void>> = [];
    const undoAll = async () => {
      for (const step of undo.reverse()) {
        await step();
      }
    };
    try {
      const [authConfig, existingAuthConfig, token, existingToken] = await Promise.all([
        environmentStore.getAuthConfig(from.scope, from.environmentId),
        environmentStore.getAuthConfig(to.scope, to.environmentId),
        environmentStore.getToken(from.scope, from.environmentId),
        environmentStore.getToken(to.scope, to.environmentId)
      ]);
      if (authConfig && !existingAuthConfig) {
        await environmentStore.setAuthConfig(to.scope, to.environmentId, authConfig);
        const revision = environmentStore.getAuthConfigRevision(to.scope, to.environmentId);
        undo.push(async () => {
          // A sign-in since the copy owns the secret now.
          if (environmentStore.getAuthConfigRevision(to.scope, to.environmentId) === revision) {
            await environmentStore.deleteAuthConfig(to.scope, to.environmentId);
          }
        });
      }
      if (token && !existingToken) {
        await environmentStore.setToken(to.scope, to.environmentId, token);
        undo.push(() => environmentStore.deleteToken(to.scope, to.environmentId));
      }
    } catch (error) {
      try {
        await undoAll();
      } catch (undoError) {
        console.warn(
          `Failed to remove credentials copied for ${candidate.declared.id}.`,
          undoError
        );
      }
      throw error;
    }
    return { copied: undo.length, undo: undoAll };
  }

  /**
   * Acknowledges the declaration exactly as it was matched (a settings edit made meanwhile is
   * never confirmed unseen) and returns an undo that restores the previous acknowledgment, or
   * undefined when the declaration changed.
   */
  private async acknowledgeMatchedDeclaration(
    declared: DeclaredEnvironment
  ): Promise<EnvironmentRecordsCopy | undefined> {
    const { registry } = this.dependencies;
    const { scope, id } = declared;
    const expected = getExpectedOriginAcknowledgment(declared);
    if (!expected) {
      return undefined;
    }
    const previous = registry.getAcknowledgedOrigin(scope, id);
    const acknowledged = await registry.acknowledgeOrigin(scope, id, {
      expected,
      loginPage: "from-credentials"
    });
    if (!acknowledged) {
      return undefined;
    }
    const written = registry.getAcknowledgedOrigin(scope, id);
    return {
      copied: 1,
      undo: async () => {
        // Undo only our own write; a later sign-in or confirmation stays. The registry drops
        // any client built while the acknowledgment stood.
        await registry.restoreAcknowledgedOrigin(scope, id, previous, { onlyIf: written });
      }
    };
  }

  private async rollBack(
    copies: readonly EnvironmentRecordsCopy[],
    failures: Error[]
  ): Promise<AdoptionResult> {
    const results = await Promise.allSettled(copies.map(async (copy) => copy.undo()));
    const rollbackFailures = results.flatMap((result) =>
      result.status === "rejected" ? [toError(result.reason)] : []
    );
    return { status: "failed", failures, rollbackFailures };
  }

  /** Copied job URLs keep the manual URL's spelling; move them onto the declared URL. */
  private async rebaseOntoDeclaredUrl(candidate: AdoptionCandidate): Promise<Error[]> {
    const { declared, stored } = candidate;
    const newBase = ensureTrailingSlash(declared.url);
    const oldBases = [
      ...new Set([
        ensureTrailingSlash(stored.url),
        ensureTrailingSlash(stripUrlCredentials(stored.url))
      ])
    ].filter((url) => url !== newBase);
    if (oldBases.length === 0) {
      return [];
    }
    try {
      const failures = await this.dependencies.urlRebaseService.rebase({
        id: declared.id,
        scope: declared.scope,
        url: declared.url,
        previousUrls: oldBases
      });
      return failures.map((failure) => toLabelledRecordError("URL rebase", failure));
    } catch (error) {
      return [toLabelledRecordError("URL rebase", error)];
    }
  }
}

function toKey(scope: EnvironmentScope, id: string): string {
  return `${scope}:${id}`;
}

function toPairKey(candidate: AdoptionCandidate): string {
  return `${toKey(candidate.declared.scope, candidate.declared.id)}|${toKey(
    candidate.stored.scope,
    candidate.stored.id
  )}`;
}

function formatTitle(environment: { name?: string; url: string }): string {
  return formatEnvironmentDisplayName({
    name: environment.name,
    url: stripUrlCredentials(environment.url)
  });
}

function toError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason));
}

function formatErrors(errors: readonly Error[]): string {
  return errors.map((error) => error.message).join("; ");
}
