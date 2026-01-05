import * as vscode from "vscode";
import type { JenkinsClientProvider } from "../jenkins/JenkinsClientProvider";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import type { JenkinsEnvironmentStore } from "../storage/JenkinsEnvironmentStore";
import type { JenkinsPinStore } from "../storage/JenkinsPinStore";
import type { JenkinsWatchStore } from "../storage/JenkinsWatchStore";
import { addEnvironment, removeEnvironment } from "./environment/EnvironmentCommandHandlers";
import type { EnvironmentCommandRefreshHost } from "./environment/EnvironmentCommandTypes";

export function registerEnvironmentCommands(
  context: vscode.ExtensionContext,
  store: JenkinsEnvironmentStore,
  watchStore: JenkinsWatchStore,
  pinStore: JenkinsPinStore,
  clientProvider: JenkinsClientProvider,
  refreshHost: EnvironmentCommandRefreshHost
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("jenkinsWorkbench.addEnvironment", () =>
      addEnvironment(store, refreshHost)
    ),
    vscode.commands.registerCommand(
      "jenkinsWorkbench.removeEnvironment",
      (item?: JenkinsEnvironmentRef) =>
        removeEnvironment(store, watchStore, pinStore, clientProvider, refreshHost, item)
    )
  );
}

export type { EnvironmentCommandRefreshHost };
