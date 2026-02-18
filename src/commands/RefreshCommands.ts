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

        if (item) {
          refreshHost.fullEnvironmentRefresh({
            environmentId: item.environmentId,
            trigger: "manual",
            refreshToken: refreshWaiter.token
          });
          await refreshWaiter.promise;
          await expansionState.restore(snapshot);
          return;
        }

        const result = refreshHost.fullEnvironmentRefresh({
          trigger: "manual",
          refreshToken: refreshWaiter.token
        });
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
