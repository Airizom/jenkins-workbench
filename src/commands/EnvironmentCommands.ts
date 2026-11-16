import * as vscode from "vscode";
import type { DeclaredEnvironmentRegistry } from "../environments/sharing/DeclaredEnvironmentRegistry";
import type { DeclaredEnvironmentSource } from "../environments/sharing/DeclaredEnvironmentSource";
import { EnvironmentSettingsWriter } from "../environments/sharing/EnvironmentSettingsWriter";
import type { JenkinsClientProvider } from "../jenkins/JenkinsClientProvider";
import {
  type JenkinsEnvironmentRef,
  toJenkinsEnvironmentRef
} from "../jenkins/JenkinsEnvironmentRef";
import type { BrowserSsoAuthenticator } from "../services/BrowserSsoAuthenticationService";
import type { EnvironmentAdoptionService } from "../services/EnvironmentAdoptionService";
import type { EnvironmentUrlRebaseService } from "../services/EnvironmentUrlRebaseService";
import { createLazyOutputChannel } from "../shared/LazyOutputChannel";
import type { EnvironmentRecordParticipant } from "../storage/EnvironmentRecordParticipant";
import type { JenkinsEnvironmentStore } from "../storage/JenkinsEnvironmentStore";
import {
  openEnvironmentDeclaration,
  showHiddenEnvironments
} from "./environment/DeclaredEnvironmentCommands";
import {
  addEnvironment,
  editEnvironment,
  removeEnvironment,
  signInWithBrowserSso
} from "./environment/EnvironmentCommandHandlers";
import {
  promptEnvironmentTarget,
  resolveSavedEnvironment,
  toEnvironmentTarget
} from "./environment/EnvironmentCommandHelpers";
import type {
  EnvironmentCommandRefreshHost,
  EnvironmentDiagnosticsLauncher
} from "./environment/EnvironmentCommandTypes";
import {
  type EnvironmentSharingDependencies,
  exportEnvironments,
  importEnvironments,
  shareEnvironmentInSettings
} from "./environment/EnvironmentSharingCommands";
import { signInToEnvironment } from "./environment/EnvironmentSignInCommand";

/** Services behind Export, Import and Share in Settings; lazy references are fine. */
export interface EnvironmentSharingServices {
  source: DeclaredEnvironmentSource;
  adoption: EnvironmentAdoptionService;
}

export function registerEnvironmentCommands(
  context: vscode.ExtensionContext,
  store: JenkinsEnvironmentStore,
  registry: DeclaredEnvironmentRegistry,
  participants: readonly EnvironmentRecordParticipant[],
  browserSsoAuthenticator: BrowserSsoAuthenticator,
  clientProvider: JenkinsClientProvider,
  urlRebaseService: EnvironmentUrlRebaseService,
  refreshHost: EnvironmentCommandRefreshHost,
  diagnostics?: EnvironmentDiagnosticsLauncher,
  sharing?: EnvironmentSharingServices
): void {
  const sharingLog = createLazyOutputChannel("Jenkins Environment Sharing");
  context.subscriptions.push(sharingLog);
  // Built once so concurrent settings writes are serialized.
  const sharingDependencies: EnvironmentSharingDependencies | undefined = sharing
    ? {
        store,
        source: sharing.source,
        adoption: sharing.adoption,
        writer: new EnvironmentSettingsWriter({ source: sharing.source, store }),
        refreshHost,
        log: sharingLog
      }
    : undefined;
  const withSharing =
    <T>(run: (dependencies: EnvironmentSharingDependencies) => Promise<T>) =>
    async (): Promise<T | undefined> => {
      if (!sharingDependencies) {
        void vscode.window.showErrorMessage("Environment sharing is not available.");
        return undefined;
      }
      return run(sharingDependencies);
    };

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "jenkinsWorkbench.testConnection",
      async (item?: JenkinsEnvironmentRef) => {
        if (!diagnostics) {
          return;
        }
        const target = item
          ? toEnvironmentTarget(item)
          : await promptEnvironmentTarget(store, {
              emptyMessage: "Add a Jenkins environment before testing a connection.",
              placeHolder: "Select a Jenkins environment to diagnose"
            });
        if (!target) {
          return;
        }
        const environment = await resolveSavedEnvironment(store, target);
        if (!environment) {
          return;
        }
        try {
          await diagnostics.show(toJenkinsEnvironmentRef({ ...environment, scope: target.scope }));
        } catch {
          void vscode.window.showErrorMessage("Unable to open environment diagnostics. Try again.");
        }
      }
    ),
    vscode.commands.registerCommand("jenkinsWorkbench.addEnvironment", () =>
      addEnvironment(store, browserSsoAuthenticator, refreshHost, { diagnostics })
    ),
    vscode.commands.registerCommand(
      "jenkinsWorkbench.signInWithBrowserSso",
      (item?: JenkinsEnvironmentRef) =>
        signInWithBrowserSso(
          store,
          registry,
          browserSsoAuthenticator,
          clientProvider,
          refreshHost,
          item,
          { diagnostics }
        )
    ),
    vscode.commands.registerCommand(
      "jenkinsWorkbench.editEnvironment",
      (item?: JenkinsEnvironmentRef) =>
        editEnvironment(
          {
            store,
            registry,
            browserSsoAuthenticator,
            clientProvider,
            urlRebaseService,
            refreshHost,
            diagnostics
          },
          item
        )
    ),
    vscode.commands.registerCommand(
      "jenkinsWorkbench.signInToEnvironment",
      (item?: JenkinsEnvironmentRef) =>
        signInToEnvironment(
          { store, registry, browserSsoAuthenticator, clientProvider, refreshHost, diagnostics },
          item
        )
    ),
    vscode.commands.registerCommand(
      "jenkinsWorkbench.openEnvironmentDeclaration",
      (item?: JenkinsEnvironmentRef) => openEnvironmentDeclaration(store, registry, item)
    ),
    vscode.commands.registerCommand("jenkinsWorkbench.showHiddenEnvironments", () =>
      showHiddenEnvironments(registry, refreshHost)
    ),
    vscode.commands.registerCommand(
      "jenkinsWorkbench.removeEnvironment",
      (item?: JenkinsEnvironmentRef) => remove(item)
    ),
    // Tree title for shared environments; the same flow hides instead of removing them.
    vscode.commands.registerCommand(
      "jenkinsWorkbench.hideEnvironment",
      (item?: JenkinsEnvironmentRef) => remove(item)
    ),
    vscode.commands.registerCommand(
      "jenkinsWorkbench.exportEnvironments",
      withSharing(exportEnvironments)
    ),
    vscode.commands.registerCommand(
      "jenkinsWorkbench.importEnvironments",
      withSharing(importEnvironments)
    ),
    vscode.commands.registerCommand(
      "jenkinsWorkbench.shareEnvironmentInSettings",
      (item?: JenkinsEnvironmentRef) =>
        withSharing((dependencies) => shareEnvironmentInSettings(dependencies, item))()
    )
  );

  function remove(item?: JenkinsEnvironmentRef): Promise<void> {
    return removeEnvironment(store, registry, participants, clientProvider, refreshHost, item);
  }
}

export type { EnvironmentCommandRefreshHost };
