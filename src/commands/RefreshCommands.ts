import * as vscode from "vscode";
import type { ExtensionRefreshHost } from "../extension/ExtensionRefreshHost";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import type { JenkinsWorkbenchTreeDataProvider } from "../tree/TreeDataProvider";
import type { TreeExpansionState } from "../tree/TreeExpansionState";

export function registerRefreshCommands(
  context: vscode.ExtensionContext,
  provider: JenkinsWorkbenchTreeDataProvider,
  expansionState: TreeExpansionState,
  refreshHost: ExtensionRefreshHost
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "jenkinsWorkbench.refresh",
      async (item?: JenkinsEnvironmentRef) => {
        const snapshot = expansionState.snapshot();
        const refreshWaiter = provider.createRefreshWaiter();
        const refreshRequest: Parameters<ExtensionRefreshHost["fullEnvironmentRefresh"]>[0] = item
          ? {
              environmentId: item.environmentId,
              trigger: "manual",
              refreshToken: refreshWaiter.token
            }
          : {
              trigger: "manual",
              refreshToken: refreshWaiter.token
            };
        const result = refreshHost.fullEnvironmentRefresh(refreshRequest);

        if (!result.executed) {
          refreshWaiter.dispose();
          return;
        }

        await refreshWaiter.promise;
        await expansionState.restore(snapshot);
      }
    )
  );
}
