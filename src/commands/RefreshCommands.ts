import * as vscode from "vscode";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import type { JenkinsWorkbenchTreeDataProvider } from "../tree/TreeDataProvider";
import type { TreeExpansionState } from "../tree/TreeExpansionState";
import type { ExtensionRefreshHost } from "../extension/ExtensionRefreshHost";

export function registerRefreshCommands(
  context: vscode.ExtensionContext,
  provider: JenkinsWorkbenchTreeDataProvider,
  expansionState: TreeExpansionState,
  refreshHost?: ExtensionRefreshHost
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "jenkinsWorkbench.refresh",
      async (item?: JenkinsEnvironmentRef) => {
        const snapshot = expansionState.snapshot();
        const refreshWaiter = provider.createRefreshWaiter();

        if (item) {
          provider.onEnvironmentChanged(item.environmentId, refreshWaiter.token);
          refreshHost?.signalEnvironmentRefresh?.(item.environmentId);
          await refreshWaiter.promise;
          await expansionState.restore(snapshot);
          return;
        }

        const didRefresh = provider.refresh(refreshWaiter.token);
        refreshHost?.signalEnvironmentRefresh?.(undefined);
        if (!didRefresh) {
          refreshWaiter.dispose();
          return;
        }
        await refreshWaiter.promise;
        await expansionState.restore(snapshot);
      }
    )
  );
}
