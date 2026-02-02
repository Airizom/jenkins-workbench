import * as vscode from "vscode";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import type { JenkinsWorkbenchTreeDataProvider } from "../tree/TreeDataProvider";
import type { ExtensionRefreshHost } from "../extension/ExtensionRefreshHost";

export function registerRefreshCommands(
  context: vscode.ExtensionContext,
  provider: JenkinsWorkbenchTreeDataProvider,
  refreshHost?: ExtensionRefreshHost
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("jenkinsWorkbench.refresh", (item?: JenkinsEnvironmentRef) => {
      if (item) {
        provider.onEnvironmentChanged(item.environmentId);
        refreshHost?.signalEnvironmentRefresh?.(item.environmentId);
        return;
      }
      provider.refresh();
      refreshHost?.signalEnvironmentRefresh?.(undefined);
    })
  );
}
