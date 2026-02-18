import * as vscode from "vscode";
import { BuildQueueFolderTreeItem, InstanceTreeItem, RootSectionTreeItem } from "../tree/TreeItems";
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
import type { ExtensionContainer } from "./container/ExtensionContainer";
import { syncJenkinsfileContext } from "./contextKeys";

export function registerExtensionSubscriptions(
  context: vscode.ExtensionContext,
  container: ExtensionContainer
): void {
  const viewStateStore = container.get("viewStateStore");
  const treeDataProvider = container.get("treeDataProvider");
  const treeView = container.get("treeView");
  const dataService = container.get("dataService");
  const poller = container.get("poller");
  const queuePoller = container.get("queuePoller");
  const jenkinsfileValidationCoordinator = container.get("jenkinsfileValidationCoordinator");
  const jenkinsfileMatcher = container.get("jenkinsfileMatcher");

  const viewStateSubscription = viewStateStore.onDidChange(() => {
    treeDataProvider.refreshView();
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
      dataService.updateCacheTtlMs(getCacheTtlMs(updatedConfig));
      treeDataProvider.refresh();
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
      treeDataProvider.updateBuildTooltipOptions(getBuildTooltipOptions(updatedConfig));
      treeDataProvider.updateBuildListFetchOptions(getBuildListFetchOptions(updatedConfig));
      if (affectsBuildTooltipDetails || affectsBuildTooltipParameters) {
        dataService.clearCache();
      }
      treeDataProvider.refreshView();
    }

    if (
      affectsJenkinsfileValidation ||
      affectsJenkinsfileRunOnSave ||
      affectsJenkinsfileDebounce ||
      affectsJenkinsfilePatterns
    ) {
      jenkinsfileValidationCoordinator.updateConfig(getJenkinsfileValidationConfig(updatedConfig));
      void syncJenkinsfileContext(jenkinsfileMatcher);
    }
  });

  const expandSubscription = treeView.onDidExpandElement((event) => {
    if (event.element instanceof BuildQueueFolderTreeItem) {
      queuePoller.trackExpanded(event.element.environment);
    }
  });

  const collapseSubscription = treeView.onDidCollapseElement((event) => {
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
