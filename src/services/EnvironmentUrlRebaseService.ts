import type * as vscode from "vscode";
import type { HistoryBaselineStore } from "../history/HistoryBaseline";
import { rebaseEnvironmentUrl } from "../jenkins/urls";
import type { JenkinsCommitWatchStore } from "../storage/JenkinsCommitWatchStore";
import type { JenkinsDiagnosticProfileBindingStore } from "../storage/JenkinsDiagnosticProfileBindingStore";
import type {
  EnvironmentScope,
  EnvironmentWithScope,
  JenkinsEnvironmentStore,
  JenkinsEnvironmentUpdate
} from "../storage/JenkinsEnvironmentStore";
import type { JenkinsParameterPresetStore } from "../storage/JenkinsParameterPresetStore";
import type { JenkinsPinStore } from "../storage/JenkinsPinStore";
import type { JenkinsRepositoryLinkStore } from "../storage/JenkinsRepositoryLinkStore";
import type { JenkinsViewStateStore } from "../storage/JenkinsViewStateStore";
import type { JenkinsWatchStore } from "../storage/JenkinsWatchStore";

export interface EnvironmentUrlRebaseDependencies {
  environmentStore: JenkinsEnvironmentStore;
  pinStore: JenkinsPinStore;
  watchStore: JenkinsWatchStore;
  presetStore: JenkinsParameterPresetStore;
  diagnosticBindingStore: JenkinsDiagnosticProfileBindingStore;
  repositoryLinkStore: JenkinsRepositoryLinkStore;
  historyBaselineStore: HistoryBaselineStore;
  viewStateStore: JenkinsViewStateStore;
  commitWatchStore: JenkinsCommitWatchStore;
  /** Records, per workspace, the URL each environment's stored data was last rebased onto. */
  workspaceState: vscode.Memento;
}

export interface EnvironmentUrlChange {
  update: JenkinsEnvironmentUpdate;
  failures: unknown[];
}

const REBASED_URLS_KEY = "jenkinsWorkbench.environmentUrlRebases";

/**
 * Rewrites stored absolute Jenkins URLs after an environment's URL was edited, so pins, watches,
 * presets, bindings, links, baselines, branch filters, commit watches and the Browser SSO
 * sign-in URL follow the environment.
 * Every store rebase is idempotent, which lets activation replay it for workspaces that were
 * closed when the edit happened.
 */
export class EnvironmentUrlRebaseService {
  constructor(private readonly dependencies: EnvironmentUrlRebaseDependencies) {}

  /**
   * Changes an environment's URL and rebases its stored data before `environment-updated`
   * fires, so listeners see one consistent state. Returns undefined if the environment is gone.
   */
  async changeUrl(
    scope: EnvironmentScope,
    id: string,
    url: string
  ): Promise<EnvironmentUrlChange | undefined> {
    let failures: unknown[] = [];
    const update = await this.dependencies.environmentStore.updateEnvironment(
      scope,
      id,
      { url },
      {
        beforeNotify: async ({ next }) => {
          failures = await this.rebaseAndRecord({ ...next, scope });
        }
      }
    );
    return update ? { update, failures } : undefined;
  }

  /**
   * Rebases every stored URL for this environment from its `previousUrls` onto its current `url`.
   * Never throws; returns the failures from individual stores.
   */
  async rebase(environment: EnvironmentWithScope): Promise<unknown[]> {
    const oldBases = environment.previousUrls ?? [];
    if (oldBases.length === 0) {
      return [];
    }

    const { scope, id: environmentId, url: newBase } = environment;
    const {
      pinStore,
      watchStore,
      presetStore,
      diagnosticBindingStore,
      repositoryLinkStore,
      historyBaselineStore,
      viewStateStore,
      commitWatchStore
    } = this.dependencies;
    const steps: Array<[label: string, run: () => Promise<unknown>]> = [
      ["pinned jobs", () => pinStore.rebasePinUrls(scope, environmentId, oldBases, newBase)],
      ["watched jobs", () => watchStore.rebaseWatchUrls(scope, environmentId, oldBases, newBase)],
      [
        "parameter presets",
        () => presetStore.rebasePresetUrls(scope, environmentId, oldBases, newBase)
      ],
      [
        "diagnostic profile bindings",
        () => diagnosticBindingStore.rebaseBindingUrls(scope, environmentId, oldBases, newBase)
      ],
      [
        "repository links",
        () => repositoryLinkStore.rebaseLinkUrls({ scope, environmentId }, oldBases, newBase)
      ],
      [
        "history baselines",
        () => historyBaselineStore.rebaseBaselineUrls(scope, environmentId, oldBases, newBase)
      ],
      [
        "branch filters",
        () => viewStateStore.rebaseBranchFilterUrls(environmentId, oldBases, newBase)
      ],
      [
        "commit watches",
        () => commitWatchStore.rebaseCommitWatchUrls(scope, environmentId, oldBases, newBase)
      ],
      ["Browser SSO sign-in URL", () => this.rebaseSsoLoginUrl(environment)]
    ];

    // Wrap so a store that throws synchronously is reported like a rejected one.
    const results = await Promise.allSettled(steps.map(async ([, run]) => run()));
    return results.flatMap((result, index) =>
      result.status === "rejected" ? [toRebaseFailure(steps[index][0], result.reason)] : []
    );
  }

  private async rebaseAndRecord(environment: EnvironmentWithScope): Promise<unknown[]> {
    const failures = await this.rebase(environment);
    if (failures.length === 0) {
      try {
        const { workspaceState } = this.dependencies;
        await workspaceState.update(REBASED_URLS_KEY, {
          ...this.readRebasedUrls(),
          [rebaseKey(environment)]: environment.url
        });
      } catch (error) {
        // Without the marker the next activation simply rebases again, which is a no-op.
        console.warn("Failed to record rebased Jenkins environment URL.", error);
      }
    }
    return failures;
  }

  private readRebasedUrls(): Record<string, string> {
    const stored = this.dependencies.workspaceState.get<unknown>(REBASED_URLS_KEY);
    return stored && typeof stored === "object" ? (stored as Record<string, string>) : {};
  }

  /** Keeps sign-in and automatic reauth from opening the old server's sign-in page. */
  private async rebaseSsoLoginUrl(environment: EnvironmentWithScope): Promise<void> {
    const { environmentStore } = this.dependencies;
    const { scope, id } = environment;
    // Read the revision first so a reauth that lands mid-read can't be overwritten with old headers.
    const revision = environmentStore.getAuthConfigRevision(scope, id);
    const authConfig = await environmentStore.getAuthConfig(scope, id);
    if (authConfig?.type !== "sso") {
      return;
    }
    const loginUrl = rebaseEnvironmentUrl(
      authConfig.loginUrl,
      environment.previousUrls ?? [],
      environment.url
    );
    if (loginUrl) {
      await environmentStore.setAuthConfigIfRevision(
        scope,
        id,
        { ...authConfig, loginUrl },
        revision
      );
    }
  }

  /**
   * Activation pass: rebases environments whose URL changed since this workspace last caught up,
   * covering the workspace-only stores of URL edits made in another window. Failures are retried
   * on the next activation.
   */
  async rebaseAll(): Promise<void> {
    const environments = await this.dependencies.environmentStore.listEnvironmentsWithScope();
    const rebased = this.readRebasedUrls();
    for (const environment of environments) {
      if (
        !environment.previousUrls?.length ||
        rebased[rebaseKey(environment)] === environment.url
      ) {
        continue;
      }
      const failures = await this.rebaseAndRecord(environment);
      if (failures.length > 0) {
        console.warn(
          `Failed to rebase stored Jenkins URLs for environment ${environment.id}.`,
          failures
        );
      }
    }
  }
}

function rebaseKey(environment: EnvironmentWithScope): string {
  return `${environment.scope}:${environment.id}`;
}

function toRebaseFailure(label: string, reason: unknown): Error {
  const message = reason instanceof Error ? reason.message : String(reason);
  return new Error(`${label}: ${message}`, { cause: reason });
}
