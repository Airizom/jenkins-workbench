import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import type { JenkinsQueuePoller } from "../queue/JenkinsQueuePoller";
import type { JenkinsEnvironmentStore } from "../storage/JenkinsEnvironmentStore";
import type { JenkinsWorkbenchTreeDataProvider } from "../tree/TreeDataProvider";
import { syncNoEnvironmentsContext } from "./contextKeys";

export interface ExtensionRefreshHost {
  refreshEnvironment(environmentId?: string): void;
  onEnvironmentRemoved?(environment: JenkinsEnvironmentRef): void;
}

export function createExtensionRefreshHost(
  environmentStore: JenkinsEnvironmentStore,
  treeDataProvider: JenkinsWorkbenchTreeDataProvider,
  queuePoller: JenkinsQueuePoller
): ExtensionRefreshHost {
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
    },
    onEnvironmentRemoved: (environment: JenkinsEnvironmentRef) =>
      queuePoller.clearEnvironment(environment)
  };
}
