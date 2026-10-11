import * as vscode from "vscode";
import type { JenkinsEnvironmentStoreChange } from "../storage/JenkinsEnvironmentStore";
import {
  ActivityFolderTreeItem,
  BuildQueueFolderTreeItem,
  InstanceTreeItem
} from "../tree/TreeItems";
import type { ExtensionContainer } from "./container/ExtensionContainer";
import type { ExtensionTokenMap } from "./container/ExtensionTokenMap";
import { syncJenkinsfileContext } from "./contextKeys";
import {
  buildConfigKey,
  CONFIG_KEYS,
  type ConfigKey,
  getBuildListFetchOptions,
  getBuildTooltipOptions,
  getCacheTtlMs,
  getCurrentBranchPullRequestJobNamePatterns,
  getExtensionConfiguration,
  getJenkinsfileIntelligenceConfig,
  getJenkinsfileValidationConfig,
  getQueuePollIntervalSeconds,
  getStatusRefreshIntervalSeconds,
  getTreeActivityOptions,
  getTreeViewCurationOptions,
  getWatchErrorThreshold
} from "./ExtensionConfig";

const BUILD_TOOLTIP_CONFIG_KEYS = [
  CONFIG_KEYS.buildTooltipDetails,
  CONFIG_KEYS.buildTooltipParametersEnabled,
  CONFIG_KEYS.buildTooltipParametersAllowList,
  CONFIG_KEYS.buildTooltipParametersDenyList,
  CONFIG_KEYS.buildTooltipParametersMaskPatterns,
  CONFIG_KEYS.buildTooltipParametersMaskValue
] as const;

const JENKINSFILE_VALIDATION_CONFIG_KEYS = [
  CONFIG_KEYS.jenkinsfileValidationEnabled,
  CONFIG_KEYS.jenkinsfileValidationRunOnSave,
  CONFIG_KEYS.jenkinsfileValidationChangeDebounce,
  CONFIG_KEYS.jenkinsfileValidationFilePatterns
] as const;

const ACTIVITY_CONFIG_KEYS = [
  CONFIG_KEYS.activityMaxItemsPerGroup,
  CONFIG_KEYS.activityMaxScanResults,
  CONFIG_KEYS.activityJobSearchBatchSize,
  CONFIG_KEYS.activityPendingInputCandidateLimit,
  CONFIG_KEYS.activityPendingInputLookupConcurrency,
  CONFIG_KEYS.activityPendingInputBuildLookupLimit,
  CONFIG_KEYS.activityRefreshIntervalSeconds
] as const;

type ConfigReactionKey = ConfigKey;

interface ConfigReaction {
  keys: readonly ConfigReactionKey[];
  run: (config: vscode.WorkspaceConfiguration, changedKeys: ReadonlySet<ConfigReactionKey>) => void;
}

interface ConfigReactionMatch {
  reaction: ConfigReaction;
  changedKeys: ReadonlySet<ConfigReactionKey>;
}

function resolveConfigReactionMatches(
  event: vscode.ConfigurationChangeEvent,
  reactions: readonly ConfigReaction[]
): ConfigReactionMatch[] {
  const matches: ConfigReactionMatch[] = [];
  for (const reaction of reactions) {
    const changedKeys = new Set<ConfigReactionKey>();
    for (const key of reaction.keys) {
      if (event.affectsConfiguration(buildConfigKey(key))) {
        changedKeys.add(key);
      }
    }
    if (changedKeys.size > 0) {
      matches.push({
        reaction,
        changedKeys
      });
    }
  }
  return matches;
}

export function registerExtensionSubscriptions(
  context: vscode.ExtensionContext,
  container: ExtensionContainer
): void {
  const viewStateStore = container.get("viewStateStore");
  const environmentStore = container.get("environmentStore");
  const treeDataProvider = container.get("treeDataProvider");
  const treeView = container.get("treeView");
  const dataService = container.get("dataService");
  const refreshHost = container.get("refreshHost");
  const statusRefreshService = container.get("statusRefreshService");
  const activityRefreshService = container.get("activityRefreshService");
  const poller = container.get("poller");
  const queuePoller = container.get("queuePoller");
  const currentBranchPullRequestJobMatcher = container.get("currentBranchPullRequestJobMatcher");
  const currentBranchService = container.get("currentBranchService");
  const jenkinsfileValidationCoordinator = container.get("jenkinsfileValidationCoordinator");
  const jenkinsfileIntelligenceConfigState = container.get("jenkinsfileIntelligenceConfigState");
  const jenkinsfileMatcher = container.get("jenkinsfileMatcher");
  const jenkinsfileStepCatalogService = container.get("jenkinsfileStepCatalogService");

  const configReactions: ConfigReaction[] = [
    {
      keys: [CONFIG_KEYS.cacheTtlSeconds],
      run: (config) => {
        dataService.updateCacheTtlMs(getCacheTtlMs(config));
        refreshHost.fullEnvironmentRefresh({ trigger: "system" });
      }
    },
    {
      keys: [CONFIG_KEYS.statusRefreshIntervalSeconds],
      run: (config) => {
        statusRefreshService.updateRefreshIntervalSeconds(getStatusRefreshIntervalSeconds(config));
      }
    },
    {
      keys: [CONFIG_KEYS.watchErrorThreshold],
      run: (config) => {
        poller.updateMaxConsecutiveErrors(getWatchErrorThreshold(config));
      }
    },
    {
      keys: [CONFIG_KEYS.queuePollIntervalSeconds],
      run: (config) => {
        queuePoller.updatePollIntervalSeconds(getQueuePollIntervalSeconds(config));
      }
    },
    {
      keys: [CONFIG_KEYS.currentBranchPullRequestJobNamePatterns],
      run: (config) => {
        currentBranchPullRequestJobMatcher.updatePatterns(
          getCurrentBranchPullRequestJobNamePatterns(config)
        );
        void currentBranchService.refresh({ force: true });
      }
    },
    {
      keys: BUILD_TOOLTIP_CONFIG_KEYS,
      run: (config, changedKeys) => {
        treeDataProvider.updateBuildTooltipOptions(getBuildTooltipOptions(config));
        treeDataProvider.updateBuildListFetchOptions(getBuildListFetchOptions(config));
        const shouldClearDataCache =
          changedKeys.has(CONFIG_KEYS.buildTooltipDetails) ||
          changedKeys.has(CONFIG_KEYS.buildTooltipParametersEnabled);
        refreshHost.refreshViewOnly({
          clearDataCache: shouldClearDataCache
        });
      }
    },
    {
      keys: [CONFIG_KEYS.treeViewsExcludedNames],
      run: (config) => {
        treeDataProvider.updateViewCurationOptions(getTreeViewCurationOptions(config));
        refreshHost.refreshViewOnly();
      }
    },
    {
      keys: ACTIVITY_CONFIG_KEYS,
      run: (config) => {
        const activityOptions = getTreeActivityOptions(config);
        treeDataProvider.updateActivityOptions(activityOptions);
        activityRefreshService.updateOptions(activityOptions);
        refreshHost.refreshViewOnly();
      }
    },
    {
      keys: [CONFIG_KEYS.jenkinsfileIntelligenceEnabled],
      run: (config) => {
        jenkinsfileIntelligenceConfigState.updateConfig(getJenkinsfileIntelligenceConfig(config));
      }
    },
    {
      keys: JENKINSFILE_VALIDATION_CONFIG_KEYS,
      run: (config) => {
        jenkinsfileValidationCoordinator.updateConfig(getJenkinsfileValidationConfig(config));
        void syncJenkinsfileContext(jenkinsfileMatcher);
      }
    }
  ];

  const viewStateSubscription = viewStateStore.onDidChange(() => {
    refreshHost.refreshViewOnly();
  });

  const environmentStoreSubscription = environmentStore.onDidChange((change) => {
    invalidateJenkinsfileStepCatalog(jenkinsfileStepCatalogService, change);
    activityRefreshService.handleEnvironmentStoreChange(change);
  });

  const configSubscription = vscode.workspace.onDidChangeConfiguration((event) => {
    const matches = resolveConfigReactionMatches(event, configReactions);
    if (matches.length === 0) {
      return;
    }

    const config = getExtensionConfiguration();
    for (const match of matches) {
      match.reaction.run(config, match.changedKeys);
    }
  });

  const expandSubscription = treeView.onDidExpandElement((event) => {
    if (event.element instanceof ActivityFolderTreeItem) {
      activityRefreshService.handleActivityFolderExpanded(event.element.environment);
      return;
    }
    if (event.element instanceof BuildQueueFolderTreeItem) {
      queuePoller.trackExpanded(event.element.environment);
    }
  });

  const collapseSubscription = treeView.onDidCollapseElement((event) => {
    if (event.element instanceof ActivityFolderTreeItem) {
      activityRefreshService.handleActivityFolderCollapsed(event.element.environment);
      return;
    }
    if (event.element instanceof BuildQueueFolderTreeItem) {
      queuePoller.trackCollapsed(event.element.environment);
      return;
    }
    if (event.element instanceof InstanceTreeItem) {
      queuePoller.clearEnvironment(event.element);
      activityRefreshService.handleEnvironmentCollapsed(event.element);
    }
  });

  const activityRefreshSubscription = statusRefreshService.onDidTick(() => {
    activityRefreshService.handleStatusTick();
  });

  context.subscriptions.push(
    viewStateSubscription,
    environmentStoreSubscription,
    configSubscription,
    expandSubscription,
    collapseSubscription,
    activityRefreshSubscription
  );
}

function invalidateJenkinsfileStepCatalog(
  jenkinsfileStepCatalogService: ExtensionTokenMap["jenkinsfileStepCatalogService"],
  change: JenkinsEnvironmentStoreChange
): void {
  switch (change.kind) {
    case "bulk-update":
      jenkinsfileStepCatalogService.invalidateAll();
      return;
    case "environment-added":
    case "environment-removed":
    case "auth-config-updated":
    case "auth-config-deleted":
      jenkinsfileStepCatalogService.invalidateEnvironment({
        scope: change.scope,
        environmentId: change.environmentId
      });
      return;
  }
}
