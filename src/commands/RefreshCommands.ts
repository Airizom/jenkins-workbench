import * as vscode from "vscode";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import type { JenkinsWorkbenchTreeDataProvider } from "../tree/TreeDataProvider";

export function registerRefreshCommands(
  context: vscode.ExtensionContext,
  provider: JenkinsWorkbenchTreeDataProvider
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("jenkinsWorkbench.refresh", (item?: JenkinsEnvironmentRef) => {
      if (item) {
        provider.onEnvironmentChanged(item.environmentId);
        return;
      }
      provider.refresh();
    })
  );
}
