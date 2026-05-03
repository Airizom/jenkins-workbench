import * as vscode from "vscode";
import type { JenkinsClientProvider } from "../jenkins/JenkinsClientProvider";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import type { BrowserSsoAuthenticator } from "../services/BrowserSsoAuthenticationService";
import type { JenkinsEnvironmentStore } from "../storage/JenkinsEnvironmentStore";
import type { JenkinsParameterPresetStore } from "../storage/JenkinsParameterPresetStore";
import type { JenkinsPinStore } from "../storage/JenkinsPinStore";
import type { JenkinsWatchStore } from "../storage/JenkinsWatchStore";
import {
  addEnvironment,
  removeEnvironment,
  signInWithBrowserSso
} from "./environment/EnvironmentCommandHandlers";
import type { EnvironmentCommandRefreshHost } from "./environment/EnvironmentCommandTypes";

export function registerEnvironmentCommands(
  context: vscode.ExtensionContext,
  store: JenkinsEnvironmentStore,
  browserSsoAuthenticator: BrowserSsoAuthenticator,
  presetStore: JenkinsParameterPresetStore,
  watchStore: JenkinsWatchStore,
  pinStore: JenkinsPinStore,
  clientProvider: JenkinsClientProvider,
  refreshHost: EnvironmentCommandRefreshHost
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("jenkinsWorkbench.addEnvironment", () =>
      addEnvironment(store, browserSsoAuthenticator, refreshHost)
    ),
    vscode.commands.registerCommand(
      "jenkinsWorkbench.signInWithBrowserSso",
      (item?: JenkinsEnvironmentRef) =>
        signInWithBrowserSso(store, browserSsoAuthenticator, clientProvider, refreshHost, item)
    ),
    vscode.commands.registerCommand(
      "jenkinsWorkbench.removeEnvironment",
      (item?: JenkinsEnvironmentRef) =>
        removeEnvironment(
          store,
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
