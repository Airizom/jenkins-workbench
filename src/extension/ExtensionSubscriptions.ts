import * as vscode from "vscode";
import type { JenkinsQueuePoller } from "../queue/JenkinsQueuePoller";
import { BuildQueueFolderTreeItem, InstanceTreeItem, RootSectionTreeItem } from "../tree/TreeItems";
import type { JenkinsStatusPoller } from "../watch/JenkinsStatusPoller";
import {
  buildConfigKey,
  getCacheTtlMs,
  getExtensionConfiguration,
  getPollIntervalSeconds,
  getQueuePollIntervalSeconds,
  getWatchErrorThreshold
} from "./ExtensionConfig";
import type { ExtensionServices } from "./ExtensionServices";

export function registerExtensionSubscriptions(
  context: vscode.ExtensionContext,
  services: ExtensionServices,
  poller: JenkinsStatusPoller,
  queuePoller: JenkinsQueuePoller
): void {
  const viewStateSubscription = services.viewStateStore.onDidChange(() => {
    services.treeDataProvider.refreshView();
  });

  const configSubscription = vscode.workspace.onDidChangeConfiguration((event) => {
    const affectsCacheTtl = event.affectsConfiguration(buildConfigKey("cacheTtlSeconds"));
    const affectsPollInterval = event.affectsConfiguration(buildConfigKey("pollIntervalSeconds"));
    const affectsWatchErrors = event.affectsConfiguration(buildConfigKey("watchErrorThreshold"));
    const affectsQueuePollInterval = event.affectsConfiguration(
      buildConfigKey("queuePollIntervalSeconds")
    );

    if (
      !affectsCacheTtl &&
      !affectsPollInterval &&
      !affectsWatchErrors &&
      !affectsQueuePollInterval
    ) {
      return;
    }

    const updatedConfig = getExtensionConfiguration();

    if (affectsCacheTtl) {
      services.dataService.updateCacheTtlMs(getCacheTtlMs(updatedConfig));
      services.treeDataProvider.refresh();
    }

    if (affectsPollInterval) {
      poller.updatePollIntervalSeconds(getPollIntervalSeconds(updatedConfig));
    }

    if (affectsWatchErrors) {
      poller.updateMaxConsecutiveErrors(getWatchErrorThreshold(updatedConfig));
    }

    if (affectsQueuePollInterval) {
      queuePoller.updatePollIntervalSeconds(getQueuePollIntervalSeconds(updatedConfig));
    }
  });

  const expandSubscription = services.treeView.onDidExpandElement((event) => {
    if (event.element instanceof BuildQueueFolderTreeItem) {
      queuePoller.trackExpanded(event.element.environment);
    }
  });

  const collapseSubscription = services.treeView.onDidCollapseElement((event) => {
    if (event.element instanceof BuildQueueFolderTreeItem) {
      queuePoller.trackCollapsed(event.element.environment);
      return;
    }
    if (event.element instanceof InstanceTreeItem) {
      queuePoller.clearEnvironment(event.element);
      return;
    }
    if (event.element instanceof RootSectionTreeItem && event.element.section === "instances") {
      queuePoller.clearAll();
    }
  });

  context.subscriptions.push(
    viewStateSubscription,
    configSubscription,
    expandSubscription,
    collapseSubscription
  );
}
