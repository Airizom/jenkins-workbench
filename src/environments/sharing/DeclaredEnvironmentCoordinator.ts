import type * as vscode from "vscode";
import type { FullEnvironmentRefreshHost } from "../../extension/ExtensionRefreshHost";
import type { JenkinsClientProvider } from "../../jenkins/JenkinsClientProvider";
import type { EnvironmentAdoptionService } from "../../services/EnvironmentAdoptionService";
import type { EnvironmentUrlRebaseService } from "../../services/EnvironmentUrlRebaseService";
import { createSerialTaskQueue } from "../../storage/SerialTaskQueue";
import type { DeclaredEnvironmentRegistry } from "./DeclaredEnvironmentRegistry";
import type { DeclaredEnvironment, DeclaredEnvironmentSource } from "./DeclaredEnvironmentSource";

export interface DeclaredEnvironmentCoordinatorDependencies {
  source: Pick<DeclaredEnvironmentSource, "getDeclared" | "onDidChange">;
  registry: Pick<
    DeclaredEnvironmentRegistry,
    "reconcileUrls" | "notifyDeclaredEnvironmentsChanged" | "notifyDeclaredEnvironmentUpdated"
  >;
  urlRebaseService: Pick<EnvironmentUrlRebaseService, "rebaseAll">;
  clientProvider: Pick<JenkinsClientProvider, "invalidateClient">;
  refreshHost: FullEnvironmentRefreshHost;
  /** Offers to link same-URL manual environments after each reconcile. */
  adoptionService?: Pick<EnvironmentAdoptionService, "promptForCandidates">;
}

/**
 * Keeps local state in step with `jenkinsWorkbench.environments`: records declared URL changes as
 * previous URLs, rebases stored job URLs onto the new server, drops cached clients for changed
 * declarations, and refreshes the tree. After each reconcile it offers to link manual environments
 * that duplicate a declaration, without waiting for the answer.
 */
export class DeclaredEnvironmentCoordinator implements vscode.Disposable {
  private readonly queue = createSerialTaskQueue();
  private subscription: vscode.Disposable | undefined;
  private known = new Map<string, DeclaredEnvironment>();

  constructor(private readonly dependencies: DeclaredEnvironmentCoordinatorDependencies) {}

  /**
   * Initial reconcile at activation, then follows settings changes. Activation only rebases when a
   * declared URL changed while the window was closed; nothing has loaded yet, so it does not
   * refresh.
   */
  start(): Promise<void> {
    if (!this.subscription) {
      this.subscription = this.dependencies.source.onDidChange(() => {
        void this.reconcile(true)
          .catch((error) => {
            console.warn("Failed to apply Jenkins environment settings changes.", error);
          })
          .then(() => this.offerAdoption());
      });
    }
    return this.reconcile(false).finally(() => this.offerAdoption());
  }

  private offerAdoption(): void {
    const { adoptionService } = this.dependencies;
    if (!adoptionService) {
      return;
    }
    // Deferred so a lazily built service that fails to construct is caught here too.
    void Promise.resolve()
      .then(() => adoptionService.promptForCandidates())
      .catch((error) => {
        console.warn("Failed to offer linking Jenkins environments to shared definitions.", error);
      });
  }

  dispose(): void {
    this.subscription?.dispose();
    this.subscription = undefined;
  }

  private reconcile(notify: boolean): Promise<void> {
    return this.queue(async () => {
      const { source, registry, urlRebaseService, refreshHost } = this.dependencies;
      const declared = [...source.getDeclared("workspace"), ...source.getDeclared("global")];
      const changedUrls = await registry.reconcileUrls(declared);
      if (changedUrls.length > 0) {
        try {
          await urlRebaseService.rebaseAll();
        } catch (error) {
          console.warn("Failed to rebase stored Jenkins URLs after a settings change.", error);
        }
      }

      const previous = this.known;
      this.known = new Map(declared.map((entry) => [toKey(entry), entry]));
      if (!notify) {
        // Activation: no client has been built yet.
        return;
      }
      this.notifyChanges(previous);
      registry.notifyDeclaredEnvironmentsChanged();
      refreshHost.fullEnvironmentRefresh({ trigger: "system" });
    });
  }

  private notifyChanges(previous: ReadonlyMap<string, DeclaredEnvironment>): void {
    const { registry, clientProvider } = this.dependencies;
    for (const key of new Set([...previous.keys(), ...this.known.keys()])) {
      const before = previous.get(key);
      const after = this.known.get(key);
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        const [scope, id] = splitKey(key);
        clientProvider.invalidateClient(scope, id);
        if (before && after) {
          // Same event as a stored URL or TLS edit, so open panels close and pollers repoint.
          const urlChanged = before.url !== after.url;
          const tlsPolicyChanged = before.allowInsecureTls !== after.allowInsecureTls;
          if (urlChanged || tlsPolicyChanged) {
            registry.notifyDeclaredEnvironmentUpdated(scope, id, {
              urlChanged,
              tlsPolicyChanged
            });
          }
        }
      }
    }
  }
}

function toKey(environment: DeclaredEnvironment): string {
  return `${environment.scope}:${environment.id}`;
}

function splitKey(key: string): [DeclaredEnvironment["scope"], string] {
  const separator = key.indexOf(":");
  return [key.slice(0, separator) as DeclaredEnvironment["scope"], key.slice(separator + 1)];
}
