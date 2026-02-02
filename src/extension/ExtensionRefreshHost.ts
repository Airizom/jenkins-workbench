import * as vscode from "vscode";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import type { JenkinsQueuePoller } from "../queue/JenkinsQueuePoller";
import type { JenkinsEnvironmentStore } from "../storage/JenkinsEnvironmentStore";
import type { JenkinsWorkbenchTreeDataProvider } from "../tree/TreeDataProvider";
import { syncNoEnvironmentsContext } from "./contextKeys";

export interface ExtensionRefreshHost {
  refreshEnvironment(environmentId?: string): void;
  onEnvironmentRemoved?(environment: JenkinsEnvironmentRef): void;
  onDidRefreshEnvironment?: vscode.Event<string | undefined>;
  signalEnvironmentRefresh?(environmentId?: string): void;
}

export function createExtensionRefreshHost(
  environmentStore: JenkinsEnvironmentStore,
  treeDataProvider: JenkinsWorkbenchTreeDataProvider,
  queuePoller: JenkinsQueuePoller
): ExtensionRefreshHost {
  const refreshEmitter = new vscode.EventEmitter<string | undefined>();
  const updateQueueEnvironment = async (environmentId?: string): Promise<void> => {
    if (!environmentId) {
      return;
    }
    const environments = await environmentStore.listEnvironmentsWithScope();
    const environment = environments.find((entry) => entry.id === environmentId);
    if (!environment) {
      return;
    }
    queuePoller.updateEnvironment({
      environmentId: environment.id,
      scope: environment.scope,
      url: environment.url,
      username: environment.username
    });
  };

  return {
    refreshEnvironment: (environmentId?: string) => {
      treeDataProvider.onEnvironmentChanged(environmentId);
      void updateQueueEnvironment(environmentId);
      void syncNoEnvironmentsContext(environmentStore);
      refreshEmitter.fire(environmentId);
    },
    onDidRefreshEnvironment: refreshEmitter.event,
    signalEnvironmentRefresh: (environmentId?: string) => {
      refreshEmitter.fire(environmentId);
    },
    onEnvironmentRemoved: (environment: JenkinsEnvironmentRef) =>
      queuePoller.clearEnvironment(environment)
  };
}
