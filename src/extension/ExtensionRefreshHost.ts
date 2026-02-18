import * as vscode from "vscode";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import type { JenkinsQueuePoller } from "../queue/JenkinsQueuePoller";
import type { JenkinsEnvironmentStore } from "../storage/JenkinsEnvironmentStore";
import type {
  FullEnvironmentRefreshRequest,
  InvalidateBuildArtifactsRequest,
  JenkinsWorkbenchTreeDataProvider,
  RefreshViewOnlyRequest
} from "../tree/TreeDataProvider";
import { syncNoEnvironmentsContext } from "./contextKeys";

export type RefreshExecutionResult = { executed: boolean };
export type FullEnvironmentRefreshHost = {
  fullEnvironmentRefresh(request?: FullEnvironmentRefreshRequest): RefreshExecutionResult;
};
export type EnvironmentScopedRefreshHost = {
  fullEnvironmentRefresh(request: { environmentId: string }): RefreshExecutionResult;
};

export type HostInvalidateBuildArtifactsRequest = InvalidateBuildArtifactsRequest;

export interface ExtensionRefreshHost extends FullEnvironmentRefreshHost {
  refreshQueueOnly(environment: JenkinsEnvironmentRef): void;
  invalidateBuildArtifacts(request: HostInvalidateBuildArtifactsRequest): void;
  refreshViewOnly(request?: RefreshViewOnlyRequest): void;
  onEnvironmentRemoved?(environment: JenkinsEnvironmentRef): void;
  onDidRefreshEnvironment?: vscode.Event<string | undefined>;
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
    fullEnvironmentRefresh: (request?: FullEnvironmentRefreshRequest) => {
      const executed = treeDataProvider.fullEnvironmentRefresh(request);
      if (!executed) {
        return { executed: false };
      }
      void updateQueueEnvironment(request?.environmentId);
      void syncNoEnvironmentsContext(environmentStore);
      refreshEmitter.fire(request?.environmentId);
      return { executed: true };
    },
    refreshQueueOnly: (environment) => {
      treeDataProvider.refreshQueueOnly(environment);
    },
    invalidateBuildArtifacts: (request) => {
      treeDataProvider.invalidateBuildArtifacts(request);
    },
    refreshViewOnly: (request?: RefreshViewOnlyRequest) => {
      treeDataProvider.refreshViewOnly(request);
    },
    onDidRefreshEnvironment: refreshEmitter.event,
    onEnvironmentRemoved: (environment: JenkinsEnvironmentRef) =>
      queuePoller.clearEnvironment(environment)
  };
}
