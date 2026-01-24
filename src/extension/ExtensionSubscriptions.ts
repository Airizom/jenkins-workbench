import * as vscode from "vscode";
import type { JenkinsQueuePoller } from "../queue/JenkinsQueuePoller";
import { BuildQueueFolderTreeItem, InstanceTreeItem, RootSectionTreeItem } from "../tree/TreeItems";
import type { JenkinsStatusPoller } from "../watch/JenkinsStatusPoller";
import { syncJenkinsfileContext } from "./contextKeys";
import {
  buildConfigKey,
  getBuildListFetchOptions,
  getBuildTooltipOptions,
  getCacheTtlMs,
  getExtensionConfiguration,
  getJenkinsfileValidationConfig,
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
    const affectsBuildTooltipDetails = event.affectsConfiguration(
      buildConfigKey("buildTooltips.includeDetails")
    );
    const affectsBuildTooltipParameters = event.affectsConfiguration(
      buildConfigKey("buildTooltips.parameters.enabled")
    );
    const affectsBuildTooltipAllowList = event.affectsConfiguration(
      buildConfigKey("buildTooltips.parameters.allowList")
    );
    const affectsBuildTooltipDenyList = event.affectsConfiguration(
      buildConfigKey("buildTooltips.parameters.denyList")
    );
    const affectsBuildTooltipMaskPatterns = event.affectsConfiguration(
      buildConfigKey("buildTooltips.parameters.maskPatterns")
    );
    const affectsBuildTooltipMaskValue = event.affectsConfiguration(
      buildConfigKey("buildTooltips.parameters.maskValue")
    );
    const affectsJenkinsfileValidation = event.affectsConfiguration(
      buildConfigKey("jenkinsfileValidation.enabled")
    );
    const affectsJenkinsfileRunOnSave = event.affectsConfiguration(
      buildConfigKey("jenkinsfileValidation.runOnSave")
    );
    const affectsJenkinsfileDebounce = event.affectsConfiguration(
      buildConfigKey("jenkinsfileValidation.changeDebounceMs")
    );
    const affectsJenkinsfilePatterns = event.affectsConfiguration(
      buildConfigKey("jenkinsfileValidation.filePatterns")
    );

    if (
      !affectsCacheTtl &&
      !affectsPollInterval &&
      !affectsWatchErrors &&
      !affectsQueuePollInterval &&
      !affectsBuildTooltipDetails &&
      !affectsBuildTooltipParameters &&
      !affectsBuildTooltipAllowList &&
      !affectsBuildTooltipDenyList &&
      !affectsBuildTooltipMaskPatterns &&
      !affectsBuildTooltipMaskValue &&
      !affectsJenkinsfileValidation &&
      !affectsJenkinsfileRunOnSave &&
      !affectsJenkinsfileDebounce &&
      !affectsJenkinsfilePatterns
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

    if (
      affectsBuildTooltipDetails ||
      affectsBuildTooltipParameters ||
      affectsBuildTooltipAllowList ||
      affectsBuildTooltipDenyList ||
      affectsBuildTooltipMaskPatterns ||
      affectsBuildTooltipMaskValue
    ) {
      services.treeDataProvider.updateBuildTooltipOptions(getBuildTooltipOptions(updatedConfig));
      services.treeDataProvider.updateBuildListFetchOptions(
        getBuildListFetchOptions(updatedConfig)
      );
      if (affectsBuildTooltipDetails || affectsBuildTooltipParameters) {
        services.dataService.clearCache();
      }
      services.treeDataProvider.refreshView();
    }

    if (
      affectsJenkinsfileValidation ||
      affectsJenkinsfileRunOnSave ||
      affectsJenkinsfileDebounce ||
      affectsJenkinsfilePatterns
    ) {
      services.jenkinsfileValidationCoordinator.updateConfig(
        getJenkinsfileValidationConfig(updatedConfig)
      );
      void syncJenkinsfileContext(services.jenkinsfileMatcher);
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
