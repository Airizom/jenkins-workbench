import * as vscode from "vscode";
import type { JenkinsClientProvider } from "../jenkins/JenkinsClientProvider";
import {
  type JenkinsEnvironmentRef,
  toJenkinsEnvironmentRef
} from "../jenkins/JenkinsEnvironmentRef";
import type { BrowserSsoAuthenticator } from "../services/BrowserSsoAuthenticationService";
import type { EnvironmentUrlRebaseService } from "../services/EnvironmentUrlRebaseService";
import type { JenkinsDiagnosticProfileBindingStore } from "../storage/JenkinsDiagnosticProfileBindingStore";
import type { JenkinsEnvironmentStore } from "../storage/JenkinsEnvironmentStore";
import type { JenkinsParameterPresetStore } from "../storage/JenkinsParameterPresetStore";
import type { JenkinsPinStore } from "../storage/JenkinsPinStore";
import type { JenkinsWatchStore } from "../storage/JenkinsWatchStore";
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

export function registerEnvironmentCommands(
  context: vscode.ExtensionContext,
  store: JenkinsEnvironmentStore,
  bindingStore: JenkinsDiagnosticProfileBindingStore,
  browserSsoAuthenticator: BrowserSsoAuthenticator,
  presetStore: JenkinsParameterPresetStore,
  watchStore: JenkinsWatchStore,
  pinStore: JenkinsPinStore,
  clientProvider: JenkinsClientProvider,
  urlRebaseService: EnvironmentUrlRebaseService,
  refreshHost: EnvironmentCommandRefreshHost,
  diagnostics?: EnvironmentDiagnosticsLauncher
): void {
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
        signInWithBrowserSso(store, browserSsoAuthenticator, clientProvider, refreshHost, item, {
          diagnostics
        })
    ),
    vscode.commands.registerCommand(
      "jenkinsWorkbench.editEnvironment",
      (item?: JenkinsEnvironmentRef) =>
        editEnvironment(
          {
            store,
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
      "jenkinsWorkbench.removeEnvironment",
      (item?: JenkinsEnvironmentRef) =>
        removeEnvironment(
          store,
          bindingStore,
          presetStore,
          watchStore,
          pinStore,
          clientProvider,
          refreshHost,
          item
        )
    )
  );
}

export type { EnvironmentCommandRefreshHost };
